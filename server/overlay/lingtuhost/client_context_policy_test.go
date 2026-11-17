package lingtuhost

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/lingtu"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type clientContextPolicyResponse struct {
	DefaultModel   string                      `json:"default_model"`
	Models         []clientModel               `json:"models"`
	MaxTokens      int                         `json:"max_tokens"`
	PolicyVersion  int                         `json:"policy_version"`
	RuntimeContext lingtu.ClientRuntimeContext `json:"runtime_context"`
	Learning       lingtu.ClientLearningPolicy `json:"learning"`
}

// clientContextPolicySessionID derives a deterministic ID from the test name.
// hostDB leaves ManagedSession rows in the shared MySQL/Postgres database, and
// session IDs are primary keys limited to 64 characters, so hashing keeps each
// test unique while avoiding slashes and other characters from subtest names.
func clientContextPolicySessionID(name string) string {
	digest := sha256.Sum256([]byte(name))
	return "client-context-policy-" + hex.EncodeToString(digest[:16])
}

// clientContextPolicyHost uses the real restricted-session middleware and token
// issue path. Only the native user/session validation dependency is a fixture,
// matching the existing billing HTTP regression; account authorization and the
// config handler remain real.
func clientContextPolicyHost(t *testing.T, db *gorm.DB) (*Host, string) {
	t.Helper()
	if err := db.Create(&lingtu.ManagedAccount{UserID: 42, Status: "enabled", Model: "qwen-plus"}).Error; err != nil {
		t.Fatal(err)
	}
	vault, err := lingtu.RuntimeVault()
	if err != nil {
		t.Fatal(err)
	}
	sessions := lingtu.NewSessionStore(db, vault, "https://api.example", func(int, string, int64) error { return nil })
	if err := sessions.Migrate(); err != nil {
		t.Fatal(err)
	}
	bundle, err := sessions.Create(42, clientContextPolicySessionID(t.Name()), 1, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	return &Host{sessions: sessions}, bundle.AccessToken
}

func clientContextPolicyGET(t *testing.T, host *Host, token string) *httptest.ResponseRecorder {
	t.Helper()
	router := gin.New()
	authenticated := router.Group("/api/client", host.clientAuth)
	authenticated.GET("/config", host.config)
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest("GET", "/api/client/config", nil)
	if token != "" {
		request.Header.Set("Authorization", "Bearer "+token)
	}
	router.ServeHTTP(recorder, request)
	return recorder
}

func clientContextPolicyJSONKeys(t *testing.T, raw json.RawMessage) map[string]json.RawMessage {
	t.Helper()
	var keys map[string]json.RawMessage
	if err := json.Unmarshal(raw, &keys); err != nil {
		t.Fatal(err)
	}
	return keys
}

func assertClientContextPolicyKeys(t *testing.T, raw json.RawMessage, want ...string) {
	t.Helper()
	keys := clientContextPolicyJSONKeys(t, raw)
	if len(keys) != len(want) {
		t.Fatalf("keys = %v, want %v", keys, want)
	}
	for _, key := range want {
		if _, ok := keys[key]; !ok {
			t.Fatalf("missing key %q in %s", key, raw)
		}
	}
}

func TestLingtuClientContextPolicyProjection(t *testing.T) {
	db := modelPolicyFixtureDB(t)
	host, token := clientContextPolicyHost(t, db)

	first := lingtu.DefaultContextPolicyInput()
	first.RuntimeContext.Enabled = true
	first.RuntimeContext.SystemPrompt = "hidden-client-projection-marker\n只允许服务端保存"
	first.RuntimeContext.RetrievalBudget = 2600
	first.RuntimeContext.RetrievalOrder = []string{"binding", "canonical", "store", "template"}
	first.Learning.Enabled = true
	if _, err := lingtu.SaveContextPolicy(db, 0, first); err != nil {
		t.Fatal(err)
	}
	second := first
	second.RuntimeContext.SystemPrompt = "second-hidden-client-marker"
	second.RuntimeContext.RetrievalBudget = 3100
	if _, err := lingtu.SaveContextPolicy(db, 1, second); err != nil {
		t.Fatal(err)
	}

	recorder := clientContextPolicyGET(t, host, token)
	if recorder.Code != http.StatusOK {
		t.Fatalf("authenticated config = %d: %s", recorder.Code, recorder.Body.String())
	}
	raw := recorder.Body.Bytes()
	banned := []string{
		second.RuntimeContext.SystemPrompt,
		first.RuntimeContext.SystemPrompt,
		"system_prompt",
		"provider",
		"api_key",
		"fixture-provider-key",
		"fixture-deepseek",
		"internal_model",
	}
	for _, value := range banned {
		if strings.Contains(string(raw), value) {
			t.Fatalf("client config leaked %q: %s", value, raw)
		}
	}

	root := clientContextPolicyJSONKeys(t, raw)
	assertClientContextPolicyKeys(t, raw, "default_model", "learning", "max_tokens", "models", "policy_version", "runtime_context")
	assertClientContextPolicyKeys(t, root["runtime_context"], "enabled", "retrieval_budget", "retrieval_order")
	assertClientContextPolicyKeys(t, root["learning"], "allowed_sources", "asr_mode", "enabled", "max_calls_per_product", "max_output_tokens", "requires_review", "video_mode", "vision_enabled")

	var response clientContextPolicyResponse
	if err := json.Unmarshal(raw, &response); err != nil {
		t.Fatal(err)
	}
	if response.PolicyVersion != 2 {
		t.Fatalf("policy_version = %d, want current revision 2", response.PolicyVersion)
	}
	if !response.RuntimeContext.Enabled || response.RuntimeContext.RetrievalBudget != 3100 {
		t.Fatalf("runtime context projection = %+v", response.RuntimeContext)
	}
	if strings.Join(response.RuntimeContext.RetrievalOrder, ",") != "binding,canonical,store,template" {
		t.Fatalf("retrieval order = %v", response.RuntimeContext.RetrievalOrder)
	}
	if !response.Learning.Enabled || !response.Learning.RequiresReview {
		t.Fatalf("learning projection = %+v", response.Learning)
	}
	if response.DefaultModel != "qwen-plus" || len(response.Models) != 1 || response.Models[0].ID != "qwen-plus" {
		t.Fatalf("legacy model fields changed: %+v", response)
	}
	if response.MaxTokens != 512 {
		t.Fatalf("legacy max_tokens = %d", response.MaxTokens)
	}
}

func TestLingtuClientContextPolicyDefaultsAndLegacyFields(t *testing.T) {
	db := hostDB(t)
	host, token := clientContextPolicyHost(t, db)

	policy := lingtu.DefaultTrialPolicy()
	policy.MaxTokens = 777
	raw, err := json.Marshal(policy)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Save(&lingtu.ManagedSetting{Name: "trial_policy", Value: string(raw)}).Error; err != nil {
		t.Fatal(err)
	}

	recorder := clientContextPolicyGET(t, host, token)
	if recorder.Code != http.StatusOK {
		t.Fatalf("config without policy row = %d: %s", recorder.Code, recorder.Body.String())
	}
	var response clientContextPolicyResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	// Existing fields and their meanings survive the additive projection.
	if response.DefaultModel != "qwen-plus" || len(response.Models) != 1 || response.Models[0].ID != "qwen-plus" || response.MaxTokens != 777 {
		t.Fatalf("legacy config fields = %+v", response)
	}
	// A missing row means DefaultContextPolicy, not an error and not a fabricated revision.
	if response.PolicyVersion != 0 {
		t.Fatalf("default policy_version = %d", response.PolicyVersion)
	}
	if response.RuntimeContext.Enabled || response.RuntimeContext.RetrievalBudget != 3000 ||
		strings.Join(response.RuntimeContext.RetrievalOrder, ",") != "binding,store,canonical,template" {
		t.Fatalf("default runtime context = %+v", response.RuntimeContext)
	}
	if response.Learning.Enabled || !response.Learning.VisionEnabled || !response.Learning.RequiresReview ||
		response.Learning.MaxCallsPerProduct != 20 || response.Learning.MaxOutputTokens != 4096 ||
		response.Learning.VideoMode != "disabled" || response.Learning.ASRMode != "disabled" ||
		strings.Join(response.Learning.AllowedSources, ",") != "pdd_detail_text,pdd_detail_image" {
		t.Fatalf("default learning policy = %+v", response.Learning)
	}
}

func TestLingtuClientContextPolicyUnauthenticated(t *testing.T) {
	recorder := clientContextPolicyGET(t, &Host{}, "")
	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated config = %d: %s", recorder.Code, recorder.Body.String())
	}
	if !strings.Contains(recorder.Body.String(), `"error":"unauthorized"`) {
		t.Fatalf("unauthenticated response = %s", recorder.Body.String())
	}
	for _, field := range []string{"default_model", "policy_version", "runtime_context", "learning"} {
		if strings.Contains(recorder.Body.String(), field) {
			t.Fatalf("unauthenticated response leaked %q: %s", field, recorder.Body.String())
		}
	}
}

func TestLingtuClientContextPolicyCorruptSetting(t *testing.T) {
	savePolicy := func(t *testing.T, db *gorm.DB) string {
		t.Helper()
		input := lingtu.DefaultContextPolicyInput()
		input.RuntimeContext.SystemPrompt = "corrupt-setting-hidden-marker"
		input.RuntimeContext.Enabled = true
		if _, err := lingtu.SaveContextPolicy(db, 0, input); err != nil {
			t.Fatal(err)
		}
		return input.RuntimeContext.SystemPrompt
	}

	t.Run("damaged ciphertext", func(t *testing.T) {
		db := hostDB(t)
		host, token := clientContextPolicyHost(t, db)
		prompt := savePolicy(t, db)
		var sealed string
		if err := db.Raw("SELECT value FROM lingtu_settings WHERE name = ?", lingtu.ContextPolicySettingName).Scan(&sealed).Error; err != nil {
			t.Fatal(err)
		}
		if len(sealed) < 4 {
			t.Fatalf("unexpected sealed value length %d", len(sealed))
		}
		if err := db.Exec("UPDATE lingtu_settings SET value = ? WHERE name = ?", sealed[:len(sealed)-4]+"AAAA", lingtu.ContextPolicySettingName).Error; err != nil {
			t.Fatal(err)
		}
		recorder := clientContextPolicyGET(t, host, token)
		if recorder.Code != http.StatusServiceUnavailable {
			t.Fatalf("damaged policy config = %d: %s", recorder.Code, recorder.Body.String())
		}
		if !strings.Contains(recorder.Body.String(), `"error":"configuration_unavailable"`) ||
			strings.Contains(recorder.Body.String(), prompt) || strings.Contains(recorder.Body.String(), "policy_version") {
			t.Fatalf("damaged policy response = %s", recorder.Body.String())
		}
	})

	t.Run("unreadable setting", func(t *testing.T) {
		db := hostDB(t)
		host, token := clientContextPolicyHost(t, db)
		prompt := savePolicy(t, db)

		// adminConfig-style ordering: the trial policy read is first, the context
		// policy read is second. Fail only the new policy read.
		const queryFailure = "fixture-fail-client-context-policy-read"
		settingsReads := 0
		if err := db.Callback().Query().Before("gorm:query").Register(queryFailure, func(tx *gorm.DB) {
			if tx.Statement.Table == "lingtu_settings" {
				settingsReads++
				if settingsReads == 2 {
					tx.AddError(errors.New("fixture client context policy read failure"))
				}
			}
		}); err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { db.Callback().Query().Remove(queryFailure) })

		recorder := clientContextPolicyGET(t, host, token)
		if recorder.Code != http.StatusServiceUnavailable {
			t.Fatalf("unreadable policy config = %d: %s", recorder.Code, recorder.Body.String())
		}
		if !strings.Contains(recorder.Body.String(), `"error":"configuration_unavailable"`) || strings.Contains(recorder.Body.String(), prompt) {
			t.Fatalf("unreadable policy response = %s", recorder.Body.String())
		}
	})
}

// modelPolicyFixtureDB is the existing isolated managed-model fixture without
// its policy helper, keeping this regression focused on the client projection.
func modelPolicyFixtureDB(t *testing.T) *gorm.DB {
	t.Helper()
	db := managedModelDB(t)
	for _, ch := range []*model.Channel{
		{Name: "lingtu-deepseek", Type: 1, Group: "default", Models: "deepseek-flash", Status: 1, Key: "fixture-deepseek"},
		qwenModelFixture(),
	} {
		if err := persistManagedModel(ch, false); err != nil {
			t.Fatal(err)
		}
	}
	return db
}
