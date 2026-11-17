package lingtuhost

import (
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

type textVisionAcceptanceRelay struct {
	model  string
	images bool
}

type textVisionAcceptanceFixture struct {
	db     *gorm.DB
	engine *gin.Engine
	token  string
	relays []textVisionAcceptanceRelay
}

func newTextVisionAcceptanceFixture(t *testing.T) *textVisionAcceptanceFixture {
	t.Helper()
	db := managedModelDB(t)
	for _, channel := range []*model.Channel{
		{Name: "lingtu-deepseek", Type: 1, Group: "default", Models: "deepseek-flash", Status: common.ChannelStatusEnabled, Key: "acceptance-text-secret"},
		{Name: "lingtu-qwen-vision", Type: 1, Group: "default", Models: "qwen3-vl-plus", Status: common.ChannelStatusEnabled, Key: "acceptance-image-secret"},
	} {
		if err := persistManagedModel(channel, false); err != nil {
			t.Fatal(err)
		}
	}
	var policies int64
	if err := db.Model(&lingtu.ManagedSetting{}).Where("name = ?", "trial_policy").Count(&policies).Error; err != nil || policies != 0 {
		t.Fatalf("acceptance must start without a saved trial policy: count=%d error=%v", policies, err)
	}
	policy, err := lingtu.LoadTrialPolicy(db)
	if err != nil || policy.Calls != 100 || policy.DefaultModel != "deepseek-flash" || policy.ModelScope != "selected" || !reflect.DeepEqual(policy.AllowedModels, []string{"deepseek-flash", "qwen3-vl-plus"}) {
		t.Fatalf("new-account defaults must grant exactly 100 calls and the text/visual pair: %+v error=%v", policy, err)
	}
	vault, err := lingtu.RuntimeVault()
	if err != nil {
		t.Fatal(err)
	}
	sessions := lingtu.NewSessionStore(db, vault, "https://api.test", func(int, string, int64) error { return nil })
	if err := sessions.Migrate(); err != nil {
		t.Fatal(err)
	}
	host := &Host{sessions: sessions, trials: lingtu.NewTrialStore(db)}
	if err := host.migrateChat(); err != nil {
		t.Fatal(err)
	}
	seedManagedChatIdentity(t, db)
	if err := lingtu.EnsureManagedAccount(db, 99, time.Now()); err != nil {
		t.Fatal(err)
	}
	bundle, err := sessions.Create(99, clientContextPolicySessionID(t.Name()), 1, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	fixture := &textVisionAcceptanceFixture{db: db, engine: gin.New(), token: bundle.AccessToken}
	fixture.engine.POST("/chat", host.clientAuth, host.prepareChat, func(c *gin.Context) {
		raw, err := io.ReadAll(c.Request.Body)
		if err != nil {
			t.Error(err)
			c.AbortWithStatus(500)
			return
		}
		var admitted struct {
			Model    string        `json:"model"`
			Messages []chatMessage `json:"messages"`
		}
		if err := json.Unmarshal(raw, &admitted); err != nil {
			t.Error(err)
			c.AbortWithStatus(500)
			return
		}
		fixture.relays = append(fixture.relays, textVisionAcceptanceRelay{model: admitted.Model, images: containsImages(admitted.Messages)})
		// This is the terminal fake relay. No native relay or provider network call runs.
		c.Set("lingtu_upstream_started", true)
		c.Set("lingtu_upstream_status", 200)
		c.Set("lingtu_provider_usage_seen", true)
		c.Set("lingtu_provider_usage_known", true)
		c.Set("lingtu_provider_input_tokens", 2)
		c.Set("lingtu_provider_output_tokens", 3)
		c.JSON(200, gin.H{"choices": []gin.H{{"message": gin.H{"content": "acceptance answer"}}}, "usage": gin.H{"prompt_tokens": 2, "completion_tokens": 3}})
	})
	return fixture
}

func (f *textVisionAcceptanceFixture) call(body string) *httptest.ResponseRecorder {
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest("POST", "/chat", strings.NewReader(body))
	request.Header.Set("Authorization", "Bearer "+f.token)
	request.Header.Set("Content-Type", "application/json")
	f.engine.ServeHTTP(recorder, request)
	return recorder
}

func (f *textVisionAcceptanceFixture) assertLedger(t *testing.T, used int) {
	t.Helper()
	var grant lingtu.TrialGrant
	if err := f.db.First(&grant, 99).Error; err != nil {
		t.Fatal(err)
	}
	if grant.Limit != 100 || grant.Used != used || grant.Reserved != 0 {
		t.Fatalf("unexpected shared quota: limit=%d used=%d reserved=%d; expected 100/%d/0", grant.Limit, grant.Used, grant.Reserved, used)
	}
}

func (f *textVisionAcceptanceFixture) assertUsage(t *testing.T, id, expectedModel, purpose string) {
	t.Helper()
	var usage managedUsage
	if err := f.db.First(&usage, "user_id = ? AND request_id = ?", 99, id).Error; err != nil {
		t.Fatal(err)
	}
	if usage.Model != expectedModel || usage.UpstreamModel != expectedModel || usage.Purpose != purpose || usage.Diagnostic != "success" || !usage.UsageKnown || !usage.CostSnapshot {
		t.Fatalf("usage must record the actual admitted model and successful purpose: %+v", usage)
	}
}

func TestLingtuTextVisionAcceptanceDefaultSuccessAndReplay(t *testing.T) {
	f := newTextVisionAcceptanceFixture(t)
	f.assertLedger(t, 0)
	for index, request := range []struct {
		id, body, model string
		images          bool
	}{
		{"accept-text", `{"client_request_id":"accept-text","messages":[{"role":"user","content":"hello"}]}`, "deepseek-flash", false},
		{"accept-image", `{"client_request_id":"accept-image","messages":[{"role":"user","content":[{"type":"image_url","image_url":{"url":"https://images.example.com/acceptance.png"}}]}]}`, "qwen3-vl-plus", true},
		{"accept-mixed", `{"client_request_id":"accept-mixed","messages":[{"role":"user","content":[{"type":"text","text":"describe this picture"},{"type":"image_url","image_url":{"url":"https://images.example.com/acceptance.png"}}]}]}`, "qwen3-vl-plus", true},
	} {
		first := f.call(request.body)
		if first.Code != 200 {
			t.Fatalf("%s first call = %d: %s", request.id, first.Code, first.Body.String())
		}
		replay := f.call(request.body)
		if replay.Code != 200 || replay.Body.String() != first.Body.String() || len(f.relays) != index+1 {
			t.Fatalf("%s replay invoked a model again or changed its saved result: status=%d relays=%d body=%s", request.id, replay.Code, len(f.relays), replay.Body.String())
		}
		if actual := f.relays[index]; actual.model != request.model || actual.images != request.images {
			t.Fatalf("%s upstream payload = %+v", request.id, actual)
		}
		f.assertLedger(t, index+1)
		f.assertUsage(t, request.id, request.model, "reply")
	}
}

func TestLingtuTextVisionAcceptanceLearningUsesActualContentRoute(t *testing.T) {
	f := newTextVisionAcceptanceFixture(t)
	input := lingtu.DefaultContextPolicyInput()
	input.Learning.Enabled = true
	input.Learning.VisionEnabled = true
	policy, err := lingtu.SaveContextPolicy(f.db, 0, input)
	if err != nil {
		t.Fatal(err)
	}
	for index, request := range []struct {
		id, source, content, model string
		images                     bool
	}{
		{"accept-learn-text", "pdd_detail_text", `"product material is cotton"`, "deepseek-flash", false},
		{"accept-learn-image", "pdd_detail_image", `[{"type":"text","text":"read the product label"},{"type":"image_url","image_url":{"url":"https://images.example.com/label.png"}}]`, "qwen3-vl-plus", true},
	} {
		body, err := json.Marshal(map[string]any{"client_request_id": request.id, "purpose": "learning", "policy_version": policy.Revision, "learning_source": request.source, "messages": []map[string]any{{"role": "user", "content": json.RawMessage(request.content)}}})
		if err != nil {
			t.Fatal(err)
		}
		response := f.call(string(body))
		if response.Code != 200 || len(f.relays) != index+1 {
			t.Fatalf("%s learning = %d: %s (relays=%d)", request.id, response.Code, response.Body.String(), len(f.relays))
		}
		if actual := f.relays[index]; actual.model != request.model || actual.images != request.images {
			t.Fatalf("%s learning upstream payload = %+v", request.id, actual)
		}
		f.assertUsage(t, request.id, request.model, "learning")
		f.assertLedger(t, index+1)
	}
}

func TestLingtuTextVisionAcceptanceSharedHundredCallBoundary(t *testing.T) {
	f := newTextVisionAcceptanceFixture(t)
	// Seed already-settled history rather than issuing 98 redundant model requests.
	if err := f.db.Model(&lingtu.TrialGrant{}).Where("user_id = ?", 99).Update("used", 98).Error; err != nil {
		t.Fatal(err)
	}
	f.assertLedger(t, 98)
	for index, body := range []string{
		`{"client_request_id":"accept-99","messages":[{"role":"user","content":"hello"}]}`,
		`{"client_request_id":"accept-100","messages":[{"role":"user","content":[{"type":"text","text":"what is shown"},{"type":"image_url","image_url":{"url":"https://images.example.com/last.png"}}]}]}`,
	} {
		response := f.call(body)
		if response.Code != 200 {
			t.Fatalf("call %d = %d: %s", index+99, response.Code, response.Body.String())
		}
		f.assertLedger(t, index+99)
	}
	if len(f.relays) != 2 || f.relays[0].model != "deepseek-flash" || f.relays[1].model != "qwen3-vl-plus" {
		t.Fatalf("last two calls did not share quota across text and visual routes: %+v", f.relays)
	}
	for _, body := range []string{
		`{"client_request_id":"accept-101-text","messages":[{"role":"user","content":"one more"}]}`,
		`{"client_request_id":"accept-101-image","messages":[{"role":"user","content":[{"type":"image_url","image_url":{"url":"https://images.example.com/exhausted.png"}}]}]}`,
	} {
		response := f.call(body)
		if response.Code != 403 || !strings.Contains(response.Body.String(), `"error":"trial_exhausted"`) || len(f.relays) != 2 {
			t.Fatalf("exhausted request reached upstream or returned the wrong error: %d %s relays=%d", response.Code, response.Body.String(), len(f.relays))
		}
		f.assertLedger(t, 100)
	}
	var count int64
	if err := f.db.Model(&lingtu.TrialRequest{}).Where("user_id = ?", 99).Count(&count).Error; err != nil || count != 2 {
		t.Fatalf("exhausted requests created ledger rows: count=%d error=%v", count, err)
	}
}
