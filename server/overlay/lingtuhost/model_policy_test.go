package lingtuhost

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/lingtu"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func modelPolicyFixture(t *testing.T) (*gorm.DB, lingtu.TrialPolicy) {
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
	return db, lingtu.DefaultTrialPolicy()
}

func TestLingtuModelPolicyScopeAndFallback(t *testing.T) {
	db, policy := modelPolicyFixture(t)
	legacy, err := resolveModelPolicy(db, policy, "qwen-plus")
	if err != nil || legacy.DefaultModel != "qwen-plus" || len(legacy.Models) != 1 {
		t.Fatal(legacy, err)
	}
	policy.ModelScope = "all"
	all, err := resolveModelPolicy(db, policy, "qwen-plus")
	if err != nil || len(all.Models) != 2 || all.DefaultModel != "qwen-plus" {
		t.Fatal(all, err)
	}
	policy.ModelScope, policy.AllowedModels = "selected", []string{"deepseek-flash"}
	selected, err := resolveModelPolicy(db, policy, "qwen-plus")
	if err != nil || selected.DefaultModel != "deepseek-flash" || len(selected.Models) != 1 {
		t.Fatal(selected, err)
	}
	policy.ModelScope, policy.AllowedModels = "all", nil
	db.Model(&model.Channel{}).Where("name = ?", "lingtu-deepseek").Update("status", 2)
	fallback, err := resolveModelPolicy(db, policy, "missing")
	if err != nil || fallback.DefaultModel != "qwen-plus" || len(fallback.Models) != 1 {
		t.Fatal(fallback, err)
	}
	db.Model(&model.Channel{}).Where("name = ?", "lingtu-qwen").Update("status", 2)
	if _, err = resolveModelPolicy(db, policy, ""); err == nil {
		t.Fatal("no available model accepted")
	}
}

func TestLingtuModelPolicySaveValidation(t *testing.T) {
	db, policy := modelPolicyFixture(t)
	h := &Host{}
	base := configurationRequest{Section: "trial", Calls: 20, Days: 7, DailyCalls: 200, MaxTokens: 512, Model: "deepseek-flash", ModelScope: "selected", AllowedModels: []string{"deepseek-flash", "qwen-plus"}}
	if err := h.saveTrialConfiguration(base); err != nil {
		t.Fatal(err)
	}
	policy, _ = lingtu.LoadTrialPolicy(db)
	if policy.ModelScope != "selected" || !reflect.DeepEqual(policy.AllowedModels, base.AllowedModels) {
		t.Fatal(policy)
	}
	for _, models := range [][]string{nil, {"qwen-plus"}, {"deepseek-flash", "unknown"}, {"deepseek-flash", "deepseek-flash"}} {
		bad := base
		bad.AllowedModels = models
		if err := h.saveTrialConfiguration(bad); err == nil {
			t.Fatalf("accepted invalid models: %v", models)
		}
	}
	bad := base
	bad.ModelScope = "unknown"
	if err := h.saveTrialConfiguration(bad); err == nil {
		t.Fatal("unknown scope accepted")
	}
	// An older admin editing caps cannot accidentally erase a configured scope.
	old := base
	old.ModelScope = ""
	old.AllowedModels = nil
	old.DailyCalls = 321
	if err := h.saveTrialConfiguration(old); err != nil {
		t.Fatal(err)
	}
	policy, _ = lingtu.LoadTrialPolicy(db)
	if policy.ModelScope != "selected" || len(policy.AllowedModels) != 2 || policy.DailyCalls != 321 {
		t.Fatal(policy)
	}
}

func TestLingtuModelPolicyReferencesAndUnavailableDefault(t *testing.T) {
	db, policy := modelPolicyFixture(t)
	h := &Host{}
	r := configurationRequest{Section: "trial", Calls: policy.Calls, Days: policy.Days, DailyCalls: policy.DailyCalls, MaxTokens: policy.MaxTokens, Model: policy.DefaultModel, ModelScope: "selected", AllowedModels: []string{policy.DefaultModel, "qwen-plus"}}
	if err := h.saveTrialConfiguration(r); err != nil {
		t.Fatal(err)
	}
	var ch model.Channel
	if err := db.First(&ch, "name = ?", "lingtu-qwen").Error; err != nil {
		t.Fatal(err)
	}
	if err := h.saveModel(nil, configurationRequest{Section: "model_connection", Action: "delete", Provider: "qwen", ConnectionID: ch.Id}); err == nil {
		t.Fatal("allowed connection deleted")
	}
	r.AllowedModels = []string{policy.DefaultModel}
	if err := h.saveTrialConfiguration(r); err != nil {
		t.Fatal(err)
	}
	if err := db.Transaction(func(tx *gorm.DB) error { return saveModelPolicy(tx, "qwen-plus") }); err == nil {
		t.Fatal("default changed outside allowed range")
	}
	if err := persistManagedModel(&ch, true); err == nil {
		t.Fatal("legacy default bypassed allowed range")
	}
	r.ModelScope = "all"
	r.AllowedModels = nil
	if err := h.saveTrialConfiguration(r); err != nil {
		t.Fatal(err)
	}
	db.Model(&model.Channel{}).Where("name = ?", "lingtu-deepseek").Update("status", 2)
	r.DailyCalls = 333
	if err := h.saveTrialConfiguration(r); err != nil {
		t.Fatal("unavailable saved default blocked limit save", err)
	}
	if err := h.saveModel(nil, configurationRequest{Section: "model_connection", Action: "delete", Provider: "qwen", ConnectionID: ch.Id}); err != nil {
		t.Fatal("unreferenced model could not be deleted", err)
	}
}

func TestLingtuModelPolicyConfigAndModelDigest(t *testing.T) {
	db, policy := modelPolicyFixture(t)
	policy.ModelScope = "all"
	raw, _ := common.Marshal(policy)
	db.Save(&lingtu.ManagedSetting{Name: "trial_policy", Value: string(raw)})
	db.Create(&lingtu.ManagedAccount{UserID: 42, Status: "enabled", Model: "qwen-plus"})
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Set("lingtu_identity", lingtu.ClientIdentity{UserID: 42})
	(&Host{}).config(c)
	var cfg struct {
		DefaultModel string        `json:"default_model"`
		Models       []clientModel `json:"models"`
	}
	if json.Unmarshal(w.Body.Bytes(), &cfg) != nil || w.Code != 200 || cfg.DefaultModel != "qwen-plus" || len(cfg.Models) != 2 {
		t.Fatal(w.Code, w.Body.String())
	}
	if strings.Contains(w.Body.String(), "fixture-") || strings.Contains(w.Body.String(), "base_url") {
		t.Fatal("private config leaked")
	}
	a, d1, e1 := parseChat(strings.NewReader(`{"client_request_id":"one","model":"deepseek-flash","messages":[{"role":"user","content":"hello"}]}`))
	b, d2, e2 := parseChat(strings.NewReader(`{"client_request_id":"one","model":"qwen-plus","messages":[{"role":"user","content":"hello"}]}`))
	if e1 != nil || e2 != nil || a.Model == b.Model || d1 == d2 || chatDigest(a) != d1 {
		t.Fatal("model not bound to digest", a, b, e1, e2)
	}
}

func TestLingtuModelPolicyRejectsUnauthorizedBeforeReservation(t *testing.T) {
	db, policy := modelPolicyFixture(t)
	policy.ModelScope, policy.AllowedModels = "selected", []string{"deepseek-flash"}
	raw, _ := common.Marshal(policy)
	db.Save(&lingtu.ManagedSetting{Name: "trial_policy", Value: string(raw)})
	db.Create(&lingtu.ManagedAccount{UserID: 42, Status: "enabled", Model: "qwen-plus"})
	for _, id := range []string{"qwen-plus", "managed-unknown"} {
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Set("lingtu_identity", lingtu.ClientIdentity{UserID: 42})
		c.Request = httptest.NewRequest("POST", "/chat", strings.NewReader(`{"client_request_id":"one","model":"`+id+`","messages":[{"role":"user","content":"hi"}]}`))
		(&Host{}).prepareChat(c)
		if w.Code != 403 || !strings.Contains(w.Body.String(), "model_not_allowed") {
			t.Fatal(w.Code, w.Body.String())
		}
	}
	var count int64
	db.Model(&lingtu.TrialRequest{}).Count(&count)
	if count != 0 {
		t.Fatal("unauthorized request consumed quota")
	}
}

func TestLingtuModelPolicyRetryConflictAndLegacyDigest(t *testing.T) {
	db, _ := modelPolicyFixture(t)
	first, digest, err := parseChat(strings.NewReader(`{"client_request_id":"retry","model":"deepseek-flash","messages":[{"role":"user","content":"hi"}]}`))
	if err != nil {
		t.Fatal(err)
	}
	old, oldDigest, err := parseChat(strings.NewReader(`{"client_request_id":"old","messages":[{"role":"user","content":"hi"}]}`))
	if err != nil || oldDigest != chatDigest(old) {
		t.Fatal(err)
	}
	canonical, _ := json.Marshal(old.Messages)
	// Existing requests were keyed only by messages before optional model support.
	hash := sha256.Sum256(canonical)
	if oldDigest != hex.EncodeToString(hash[:]) {
		t.Fatal("legacy digest changed")
	}
	db.Create(&lingtu.TrialRequest{UserID: 42, RequestID: first.RequestID, Digest: digest, State: "pending", CreatedAt: time.Now().Unix()})
	first.Model = "qwen-plus"
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Set("lingtu_identity", lingtu.ClientIdentity{UserID: 42})
	if !(&Host{}).serveExisting(c, first, chatDigest(first), "") || w.Code != 409 || !strings.Contains(w.Body.String(), "request_conflict") {
		t.Fatal(w.Code, w.Body.String())
	}
}

func TestLingtuModelPolicyDispatchAndDynamicCatalog(t *testing.T) {
	db, policy := modelPolicyFixture(t)
	policy.ModelScope = "all"
	raw, _ := common.Marshal(policy)
	if err := db.Save(&lingtu.ManagedSetting{Name: "trial_policy", Value: string(raw)}).Error; err != nil {
		t.Fatal(err)
	}
	h := &Host{trials: lingtu.NewTrialStore(db)}
	if err := h.migrateChat(); err != nil {
		t.Fatal(err)
	}
	seedManagedChatIdentity(t, db)
	if err := lingtu.EnsureManagedAccount(db, 99, time.Now()); err != nil {
		t.Fatal(err)
	}
	db.Model(&lingtu.ManagedAccount{}).Where("user_id = ?", 99).Update("model", "deepseek-flash")
	dispatched := 0
	router := gin.New()
	router.POST("/chat", func(c *gin.Context) { c.Set("lingtu_identity", lingtu.ClientIdentity{UserID: 99}) }, h.prepareChat, func(c *gin.Context) {
		dispatched++
		body, _ := io.ReadAll(c.Request.Body)
		var payload struct {
			Model string `json:"model"`
		}
		json.Unmarshal(body, &payload)
		if payload.Model != "qwen-plus" || c.GetString("lingtu_upstream_model") != "qwen-plus" {
			t.Error("did not route requested model", string(body))
		}
		// Reject at the isolated fake relay boundary: never contact a real provider.
		c.AbortWithStatus(500)
	})
	w := httptest.NewRecorder()
	router.ServeHTTP(w, httptest.NewRequest("POST", "/chat", strings.NewReader(`{"client_request_id":"switch","model":"qwen-plus","messages":[{"role":"user","content":"hi"}]}`)))
	if dispatched != 1 {
		t.Fatal("allowed alternate model not dispatched", w.Code, w.Body.String())
	}
	var usage managedUsage
	if err := db.Where("user_id = ? AND request_id = ?", 99, "switch").First(&usage).Error; err != nil || usage.Model != "qwen-plus" {
		t.Fatal(usage, err)
	}
	extra := &model.Channel{Name: "lingtu-qwen-vision", Type: 1, Group: "default", Models: visionModel, Status: 1, Key: "fixture-vision"}
	if err := persistManagedModel(extra, false); err != nil {
		t.Fatal(err)
	}
	selected, err := resolveModelPolicy(db, policy, "")
	if err != nil || len(selected.Models) != 3 || !selected.allows(visionModel) {
		t.Fatal("all scope did not include newly enabled model", selected, err)
	}
}
