package lingtuhost

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"image"
	"image/png"
	"io"
	"math/rand"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/lingtu"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type contextPolicyUpstream struct {
	calls   int
	bodies  []map[string]any
	content string
}

func (u *contextPolicyUpstream) serve(c *gin.Context) {
	u.calls++
	raw, _ := io.ReadAll(c.Request.Body)
	var body map[string]any
	_ = json.Unmarshal(raw, &body)
	u.bodies = append(u.bodies, body)
	// The pinned native relay logs request bytes through this helper. Its
	// logHelper guard must replace the whole line for managed requests.
	logger.LogDebug(c, "upstream request body: %s", string(raw))
	content := u.content
	if content == "" {
		content = "context policy answer"
	}
	c.Set("lingtu_upstream_started", true)
	c.Set("lingtu_upstream_status", 200)
	c.Set("lingtu_provider_usage_seen", true)
	c.Set("lingtu_provider_usage_known", true)
	c.Set("lingtu_provider_input_tokens", 17)
	c.Set("lingtu_provider_output_tokens", 9)
	c.JSON(200, gin.H{"choices": []gin.H{{"message": gin.H{"content": content}}}, "usage": gin.H{"prompt_tokens": 17, "completion_tokens": 9}})
}

func newContextPolicyChat(t *testing.T) (*gorm.DB, *Host, string, *gin.Engine, *contextPolicyUpstream) {
	t.Helper()
	db := chatFixtureDB(t)
	if err := db.AutoMigrate(&model.Channel{}, &lingtu.ManagedSession{}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Migrator().DropTable(&model.Channel{}, &lingtu.ManagedSession{}) })
	vault, err := lingtu.RuntimeVault()
	if err != nil {
		t.Fatal(err)
	}
	sessions := lingtu.NewSessionStore(db, vault, "https://api.test", func(int, string, int64) error { return nil })
	h := &Host{sessions: sessions, trials: lingtu.NewTrialStore(db)}
	if err := h.migrateChat(); err != nil {
		t.Fatal(err)
	}
	seedManagedChatIdentity(t, db)
	if err := lingtu.EnsureManagedAccount(db, 99, time.Now()); err != nil {
		t.Fatal(err)
	}
	bundle, err := sessions.Create(99, "context-policy-session", 1, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	for _, channel := range []*model.Channel{
		{Name: "lingtu-deepseek", Type: 1, Group: "default", Status: 1, Key: "fixture-deepseek", Models: "deepseek-flash"},
		{Name: "lingtu-qwen-vision", Type: 1, Group: "default", Status: 1, Key: "fixture-vision", Models: visionModel},
	} {
		if err := db.Create(channel).Error; err != nil {
			t.Fatal(err)
		}
	}
	upstream := &contextPolicyUpstream{}
	engine := gin.New()
	engine.POST("/chat", h.clientAuth, h.prepareChat, upstream.serve)
	return db, h, bundle.AccessToken, engine, upstream
}

func contextPolicyCall(engine *gin.Engine, token, body string) *httptest.ResponseRecorder {
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest("POST", "/chat", strings.NewReader(body))
	request.Header.Set("Authorization", "Bearer "+token)
	request.Header.Set("Content-Type", "application/json")
	engine.ServeHTTP(recorder, request)
	return recorder
}

func saveContextPolicyForTest(t *testing.T, db *gorm.DB, expected int, mutate func(*lingtu.ContextPolicyInput)) lingtu.ManagedContextPolicy {
	t.Helper()
	input := lingtu.DefaultContextPolicyInput()
	if mutate != nil {
		mutate(&input)
	}
	policy, err := lingtu.SaveContextPolicy(db, expected, input)
	if err != nil {
		t.Fatal(err)
	}
	return policy
}

func learningContextPolicy() lingtu.ContextPolicyInput {
	input := lingtu.DefaultContextPolicyInput()
	input.Learning.Enabled = true
	input.Learning.MaxOutputTokens = 2048
	return input
}

func contextPolicyMessages(role string, texts ...string) []map[string]any {
	messages := make([]map[string]any, 0, len(texts))
	for _, text := range texts {
		messages = append(messages, map[string]any{"role": role, "content": text})
	}
	return messages
}

func contextPolicyRequest(t *testing.T, fields map[string]any) string {
	t.Helper()
	if _, ok := fields["client_request_id"]; !ok {
		fields["client_request_id"] = "context-policy-request"
	}
	if _, ok := fields["messages"]; !ok {
		fields["messages"] = contextPolicyMessages("user", "hello")
	}
	raw, err := json.Marshal(fields)
	if err != nil {
		t.Fatal(err)
	}
	return string(raw)
}

func contextPolicyTrialCounts(t *testing.T, db *gorm.DB) int64 {
	t.Helper()
	var count int64
	if err := db.Model(&lingtu.TrialRequest{}).Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	return count
}

func contextPolicyPNG(t *testing.T) string {
	t.Helper()
	picture := image.NewNRGBA(image.Rect(0, 0, 400, 400))
	_, _ = rand.New(rand.NewSource(7)).Read(picture.Pix)
	var buffer bytes.Buffer
	if err := png.Encode(&buffer, picture); err != nil {
		t.Fatal(err)
	}
	return "data:image/png;base64," + base64.StdEncoding.EncodeToString(buffer.Bytes())
}

func TestLingtuChatContextPolicyReply(t *testing.T) {
	db, _, token, engine, upstream := newContextPolicyChat(t)
	const hidden = "hidden-runtime-system-prompt-marker"
	saveContextPolicyForTest(t, db, 0, func(input *lingtu.ContextPolicyInput) {
		input.RuntimeContext.Enabled = true
		input.RuntimeContext.SystemPrompt = hidden
	})

	var captured bytes.Buffer
	oldWriter, oldErrorWriter, oldDebug := gin.DefaultWriter, gin.DefaultErrorWriter, common.DebugEnabled
	gin.DefaultWriter = &captured
	gin.DefaultErrorWriter = &captured
	common.DebugEnabled = true
	t.Cleanup(func() {
		gin.DefaultWriter = oldWriter
		gin.DefaultErrorWriter = oldErrorWriter
		common.DebugEnabled = oldDebug
	})

	body := contextPolicyRequest(t, map[string]any{
		"client_request_id": "reply-hidden",
		"messages": []map[string]any{
			{"role": "system", "content": "client supplied system message"},
			{"role": "user", "content": "hello"},
		},
		"max_tokens": 4096,
	})
	response := contextPolicyCall(engine, token, body)
	if response.Code != 200 {
		t.Fatalf("reply with hidden prompt = %d: %s", response.Code, response.Body.String())
	}
	if strings.Contains(response.Body.String(), hidden) || strings.Contains(response.Body.String(), "system_prompt") {
		t.Fatalf("hidden prompt leaked to the client: %s", response.Body.String())
	}
	if upstream.calls != 1 || len(upstream.bodies) != 1 {
		t.Fatalf("upstream calls = %d", upstream.calls)
	}
	upstreamBody := upstream.bodies[0]
	if upstreamBody["max_tokens"] != float64(512) {
		t.Fatalf("client output budget was not ignored: %v", upstreamBody["max_tokens"])
	}
	messages, ok := upstreamBody["messages"].([]any)
	if !ok || len(messages) != 3 {
		t.Fatalf("upstream messages = %v", upstreamBody["messages"])
	}
	first, _ := messages[0].(map[string]any)
	if first["role"] != "system" || first["content"] != hidden {
		t.Fatalf("hidden prompt is not the first server system message: %v", first)
	}
	if messages[1].(map[string]any)["content"] != "client supplied system message" || messages[2].(map[string]any)["content"] != "hello" {
		t.Fatalf("client messages changed order: %v", messages)
	}

	var usage managedUsage
	if err := db.First(&usage, "user_id = ? AND request_id = ?", 99, "reply-hidden").Error; err != nil {
		t.Fatal(err)
	}
	if usage.Purpose != "reply" {
		t.Fatalf("usage purpose = %q", usage.Purpose)
	}

	if !strings.Contains(captured.String(), "managed relay event") {
		t.Fatalf("managed log guard did not run: %s", captured.String())
	}
	if strings.Contains(captured.String(), hidden) || strings.Contains(captured.String(), "hello") {
		t.Fatalf("request bytes reached the debug log: %s", captured.String())
	}

	// Even a model that echoes its system prompt must not deliver it.
	upstream.content = hidden
	echoed := contextPolicyCall(engine, token, contextPolicyRequest(t, map[string]any{
		"client_request_id": "reply-hidden-echo",
		"messages":          []map[string]any{{"role": "user", "content": "echo"}},
	}))
	if echoed.Code == 200 || strings.Contains(echoed.Body.String(), hidden) {
		t.Fatalf("echoed hidden prompt delivered: %d %s", echoed.Code, echoed.Body.String())
	}
	upstream.content = "partial: hidden-runtime-system-prompt"
	partial := contextPolicyCall(engine, token, contextPolicyRequest(t, map[string]any{
		"client_request_id": "reply-hidden-partial",
		"messages":          []map[string]any{{"role": "user", "content": "echo part"}},
	}))
	if partial.Code == 200 || strings.Contains(partial.Body.String(), "hidden-runtime-system-prompt") {
		t.Fatalf("partial hidden prompt delivered: %d %s", partial.Code, partial.Body.String())
	}
}

func TestLingtuChatContextPolicyStrictInput(t *testing.T) {
	db, _, token, engine, upstream := newContextPolicyChat(t)
	saveContextPolicyForTest(t, db, 0, func(input *lingtu.ContextPolicyInput) {
		input.Learning.Enabled = true
	})
	learning := func() map[string]any {
		return map[string]any{
			"client_request_id": "strict-learning",
			"messages":          contextPolicyMessages("user", "hello"),
			"purpose":           "learning",
			"policy_version":    1,
			"learning_source":   "pdd_detail_text",
		}
	}
	cases := []struct {
		name  string
		build func() map[string]any
	}{
		{"null-purpose", func() map[string]any { return map[string]any{"purpose": nil} }},
		{"numeric-purpose", func() map[string]any { return map[string]any{"purpose": 7} }},
		{"unknown-purpose", func() map[string]any { return map[string]any{"purpose": "answer"} }},
		{"null-version", func() map[string]any { return map[string]any{"policy_version": nil} }},
		{"negative-version", func() map[string]any { return map[string]any{"policy_version": -1} }},
		{"fractional-version", func() map[string]any { return map[string]any{"policy_version": 1.5} }},
		{"decimal-integer-version", func() map[string]any { return map[string]any{"policy_version": json.RawMessage("1.0")} }},
		{"exponent-version", func() map[string]any { return map[string]any{"policy_version": json.RawMessage("1e3")} }},
		{"string-version", func() map[string]any { return map[string]any{"policy_version": "1"} }},
		{"boolean-version", func() map[string]any { return map[string]any{"policy_version": true} }},
		{"numeric-source", func() map[string]any {
			fields := learning()
			fields["learning_source"] = 5
			return fields
		}},
		{"unsupported-source", func() map[string]any {
			fields := learning()
			fields["learning_source"] = "pdd_detail_video"
			return fields
		}},
		{"source-with-reply", func() map[string]any {
			return map[string]any{"purpose": "reply", "learning_source": "pdd_detail_text"}
		}},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			response := contextPolicyCall(engine, token, contextPolicyRequest(t, testCase.build()))
			if response.Code != 400 || !strings.Contains(response.Body.String(), `"error":"invalid_request"`) {
				t.Fatalf("%s = %d: %s", testCase.name, response.Code, response.Body.String())
			}
		})
	}
	if upstream.calls != 0 {
		t.Fatalf("invalid input reached upstream %d times", upstream.calls)
	}
	if count := contextPolicyTrialCounts(t, db); count != 0 {
		t.Fatalf("invalid input reserved quota: %d", count)
	}
	legacy, legacyDigest, err := parseChat(strings.NewReader(`{"client_request_id":"legacy","messages":[{"role":"user","content":"hello"}]}`))
	if err != nil {
		t.Fatal(err)
	}
	explicitReply, replyDigest, err := parseChat(strings.NewReader(`{"client_request_id":"legacy","purpose":"reply","messages":[{"role":"user","content":"hello"}]}`))
	if err != nil {
		t.Fatal(err)
	}
	explicitLearning, learnDigest, err := parseChat(strings.NewReader(`{"client_request_id":"legacy","purpose":"learning","policy_version":1,"learning_source":"pdd_detail_text","messages":[{"role":"user","content":"hello"}]}`))
	if err != nil {
		t.Fatal(err)
	}
	if legacyDigest != chatDigest(legacy) || replyDigest == learnDigest || replyDigest == legacyDigest || chatDigest(explicitReply) != replyDigest || chatDigest(explicitLearning) != learnDigest {
		t.Fatal("purpose, version and learning source must participate in the digest")
	}
}

func TestLingtuChatContextPolicyLearning(t *testing.T) {
	t.Run("disabled", func(t *testing.T) {
		db, _, token, engine, upstream := newContextPolicyChat(t)
		body := contextPolicyRequest(t, map[string]any{
			"client_request_id": "learning-disabled",
			"purpose":           "learning",
			"policy_version":    0,
			"learning_source":   "pdd_detail_text",
		})
		response := contextPolicyCall(engine, token, body)
		if response.Code != 403 || !strings.Contains(response.Body.String(), `"error":"learning_disabled"`) {
			t.Fatalf("disabled learning = %d: %s", response.Code, response.Body.String())
		}
		if count := contextPolicyTrialCounts(t, db); count != 0 || upstream.calls != 0 {
			t.Fatalf("disabled learning spent quota: %d %d", count, upstream.calls)
		}
	})

	t.Run("missing-version", func(t *testing.T) {
		db, _, token, engine, upstream := newContextPolicyChat(t)
		saveContextPolicyForTest(t, db, 0, func(input *lingtu.ContextPolicyInput) { *input = learningContextPolicy() })
		body := contextPolicyRequest(t, map[string]any{
			"client_request_id": "learning-no-version",
			"purpose":           "learning",
			"learning_source":   "pdd_detail_text",
		})
		response := contextPolicyCall(engine, token, body)
		if response.Code != 400 || !strings.Contains(response.Body.String(), `"error":"policy_version_required"`) {
			t.Fatalf("learning without version = %d: %s", response.Code, response.Body.String())
		}
		if count := contextPolicyTrialCounts(t, db); count != 0 || upstream.calls != 0 {
			t.Fatalf("learning without version spent quota: %d %d", count, upstream.calls)
		}
	})

	t.Run("stale-version", func(t *testing.T) {
		db, _, token, engine, upstream := newContextPolicyChat(t)
		saveContextPolicyForTest(t, db, 0, func(input *lingtu.ContextPolicyInput) { *input = learningContextPolicy() })
		body := contextPolicyRequest(t, map[string]any{
			"client_request_id": "learning-stale",
			"purpose":           "learning",
			"policy_version":    0,
			"learning_source":   "pdd_detail_text",
		})
		response := contextPolicyCall(engine, token, body)
		if response.Code != 409 || !strings.Contains(response.Body.String(), `"error":"policy_version_stale"`) {
			t.Fatalf("stale learning = %d: %s", response.Code, response.Body.String())
		}
		if count := contextPolicyTrialCounts(t, db); count != 0 || upstream.calls != 0 {
			t.Fatalf("stale learning spent quota: %d %d", count, upstream.calls)
		}
	})

	t.Run("wrong-source", func(t *testing.T) {
		db, _, token, engine, upstream := newContextPolicyChat(t)
		saveContextPolicyForTest(t, db, 0, func(input *lingtu.ContextPolicyInput) {
			*input = learningContextPolicy()
			input.Learning.AllowedSources = []string{"pdd_detail_text"}
		})
		body := contextPolicyRequest(t, map[string]any{
			"client_request_id": "learning-wrong-source",
			"purpose":           "learning",
			"policy_version":    1,
			"learning_source":   "pdd_detail_image",
		})
		response := contextPolicyCall(engine, token, body)
		if response.Code != 403 || !strings.Contains(response.Body.String(), `"error":"learning_source_not_allowed"`) {
			t.Fatalf("wrong source = %d: %s", response.Code, response.Body.String())
		}
		if count := contextPolicyTrialCounts(t, db); count != 0 || upstream.calls != 0 {
			t.Fatalf("wrong source spent quota: %d %d", count, upstream.calls)
		}
	})

	t.Run("image-cannot-claim-text-source", func(t *testing.T) {
		db, _, token, engine, upstream := newContextPolicyChat(t)
		if err := db.Model(&lingtu.ManagedAccount{}).Where("user_id = ?", 99).Update("model", visionModel).Error; err != nil {
			t.Fatal(err)
		}
		saveContextPolicyForTest(t, db, 0, func(input *lingtu.ContextPolicyInput) {
			*input = learningContextPolicy()
			input.Learning.AllowedSources = []string{"pdd_detail_text"}
		})
		body := contextPolicyRequest(t, map[string]any{
			"client_request_id": "image-claims-text",
			"purpose":           "learning",
			"policy_version":    1,
			"learning_source":   "pdd_detail_text",
			"messages": []map[string]any{{"role": "user", "content": []map[string]any{
				{"type": "text", "text": "read this tile"},
				{"type": "image_url", "image_url": map[string]any{"url": contextPolicyPNG(t)}},
			}}},
		})
		response := contextPolicyCall(engine, token, body)
		if response.Code != 400 || !strings.Contains(response.Body.String(), `"error":"learning_source_mismatch"`) {
			t.Fatalf("image claimed text source = %d: %s", response.Code, response.Body.String())
		}
		if count := contextPolicyTrialCounts(t, db); count != 0 || upstream.calls != 0 {
			t.Fatalf("mismatched source spent quota: %d %d", count, upstream.calls)
		}
	})

	t.Run("unsupported-source", func(t *testing.T) {
		db, _, token, engine, upstream := newContextPolicyChat(t)
		saveContextPolicyForTest(t, db, 0, func(input *lingtu.ContextPolicyInput) { *input = learningContextPolicy() })
		body := contextPolicyRequest(t, map[string]any{
			"client_request_id": "learning-source-video",
			"purpose":           "learning",
			"policy_version":    1,
			"learning_source":   "pdd_detail_video",
		})
		response := contextPolicyCall(engine, token, body)
		if response.Code != 400 {
			t.Fatalf("unsupported source = %d: %s", response.Code, response.Body.String())
		}
		if count := contextPolicyTrialCounts(t, db); count != 0 || upstream.calls != 0 {
			t.Fatalf("unsupported source spent quota: %d %d", count, upstream.calls)
		}
	})

	t.Run("vision-model-unsupported", func(t *testing.T) {
		db, _, token, engine, upstream := newContextPolicyChat(t)
		saveContextPolicyForTest(t, db, 0, func(input *lingtu.ContextPolicyInput) { *input = learningContextPolicy() })
		body := contextPolicyRequest(t, map[string]any{
			"client_request_id": "learning-vision-model",
			"purpose":           "learning",
			"policy_version":    1,
			"learning_source":   "pdd_detail_image",
			"messages": []map[string]any{{"role": "user", "content": []map[string]any{
				{"type": "text", "text": "read this tile"},
				{"type": "image_url", "image_url": map[string]any{"url": contextPolicyPNG(t)}},
			}}},
		})
		response := contextPolicyCall(engine, token, body)
		if response.Code != 400 || !strings.Contains(response.Body.String(), `"error":"vision_unavailable"`) {
			t.Fatalf("text model accepted learning image = %d: %s", response.Code, response.Body.String())
		}
		if count := contextPolicyTrialCounts(t, db); count != 0 || upstream.calls != 0 {
			t.Fatalf("unsupported vision spent quota: %d %d", count, upstream.calls)
		}
	})

	t.Run("vision-policy-disabled", func(t *testing.T) {
		db, _, token, engine, upstream := newContextPolicyChat(t)
		if err := db.Model(&lingtu.ManagedAccount{}).Where("user_id = ?", 99).Update("model", visionModel).Error; err != nil {
			t.Fatal(err)
		}
		saveContextPolicyForTest(t, db, 0, func(input *lingtu.ContextPolicyInput) {
			*input = learningContextPolicy()
			input.Learning.VisionEnabled = false
		})
		body := contextPolicyRequest(t, map[string]any{
			"client_request_id": "learning-vision-disabled",
			"purpose":           "learning",
			"policy_version":    1,
			"learning_source":   "pdd_detail_image",
			"messages": []map[string]any{{"role": "user", "content": []map[string]any{
				{"type": "text", "text": "read this tile"},
				{"type": "image_url", "image_url": map[string]any{"url": contextPolicyPNG(t)}},
			}}},
		})
		response := contextPolicyCall(engine, token, body)
		if response.Code != 403 || !strings.Contains(response.Body.String(), `"error":"vision_disabled"`) {
			t.Fatalf("policy-disabled vision = %d: %s", response.Code, response.Body.String())
		}
		if count := contextPolicyTrialCounts(t, db); count != 0 || upstream.calls != 0 {
			t.Fatalf("disabled vision spent quota: %d %d", count, upstream.calls)
		}
	})
}

func TestLingtuChatContextPolicyLearningOutputAndLedger(t *testing.T) {
	db, _, token, engine, upstream := newContextPolicyChat(t)
	upstream.content = `{"candidates":[]}`
	saveContextPolicyForTest(t, db, 0, func(input *lingtu.ContextPolicyInput) {
		*input = learningContextPolicy()
		input.Learning.MaxOutputTokens = 2048
	})
	body := contextPolicyRequest(t, map[string]any{
		"client_request_id": "learning-output",
		"purpose":           "learning",
		"policy_version":    1,
		"learning_source":   "pdd_detail_text",
		"max_tokens":        8192,
		"messages":          contextPolicyMessages("user", "learn the product details"),
	})
	response := contextPolicyCall(engine, token, body)
	if response.Code != 200 {
		t.Fatalf("learning request = %d: %s", response.Code, response.Body.String())
	}
	if upstream.calls != 1 || upstream.bodies[0]["max_tokens"] != float64(2048) {
		t.Fatalf("learning output budget = %v (calls %d)", upstream.bodies[0]["max_tokens"], upstream.calls)
	}
	if upstream.bodies[0]["model"] != "deepseek-flash" {
		t.Fatalf("learning used unexpected upstream model: %v", upstream.bodies[0]["model"])
	}
	var usage managedUsage
	if err := db.First(&usage, "user_id = ? AND request_id = ?", 99, "learning-output").Error; err != nil {
		t.Fatal(err)
	}
	if usage.Purpose != "learning" || usage.Diagnostic != "success" {
		t.Fatalf("learning usage = %+v", usage)
	}
	var ledger lingtu.TrialRequest
	if err := db.First(&ledger, "user_id = ? AND request_id = ?", 99, "learning-output").Error; err != nil || ledger.State != "success" {
		t.Fatalf("learning ledger = %+v %v", ledger, err)
	}
	var grant lingtu.TrialGrant
	if err := db.First(&grant, 99).Error; err != nil || grant.Used != 1 || grant.Reserved != 0 {
		t.Fatalf("learning quota = %+v %v", grant, err)
	}
	var cached int64
	if err := db.Model(&managedResult{}).Count(&cached).Error; err != nil || cached != 1 {
		t.Fatalf("learning result cache = %d %v", cached, err)
	}

	replay := contextPolicyCall(engine, token, body)
	if replay.Code != 200 || upstream.calls != 1 {
		t.Fatalf("learning replay forwarded or failed: %d %d", replay.Code, upstream.calls)
	}
	if err := db.First(&grant, 99).Error; err != nil || grant.Used != 1 || grant.Reserved != 0 {
		t.Fatalf("learning replay debited again: %+v %v", grant, err)
	}
}

func TestLingtuChatContextPolicyIdempotency(t *testing.T) {
	db, _, token, engine, upstream := newContextPolicyChat(t)
	first := learningContextPolicy()
	saveContextPolicyForTest(t, db, 0, func(input *lingtu.ContextPolicyInput) { *input = first })
	body := contextPolicyRequest(t, map[string]any{
		"client_request_id": "learning-idempotent",
		"purpose":           "learning",
		"policy_version":    1,
		"learning_source":   "pdd_detail_text",
	})
	if response := contextPolicyCall(engine, token, body); response.Code != 200 {
		t.Fatalf("first learning = %d: %s", response.Code, response.Body.String())
	}
	if upstream.calls != 1 {
		t.Fatalf("first learning calls = %d", upstream.calls)
	}

	second := first
	second.Learning.Enabled = false
	second.Learning.MaxOutputTokens = 1024
	second.RuntimeContext.SystemPrompt = "policy changed after the first request"
	saveContextPolicyForTest(t, db, 1, func(input *lingtu.ContextPolicyInput) { *input = second })

	if response := contextPolicyCall(engine, token, body); response.Code != 200 || upstream.calls != 1 {
		t.Fatalf("stored success did not replay after policy change: %d %d", response.Code, upstream.calls)
	}
	var grant lingtu.TrialGrant
	if err := db.First(&grant, 99).Error; err != nil || grant.Used != 1 || grant.Reserved != 0 {
		t.Fatalf("replay double-debited: %+v %v", grant, err)
	}

	for _, conflict := range []map[string]any{
		{"client_request_id": "learning-idempotent", "purpose": "reply", "policy_version": 2},
		{"client_request_id": "learning-idempotent", "purpose": "learning", "policy_version": 2, "learning_source": "pdd_detail_text"},
	} {
		response := contextPolicyCall(engine, token, contextPolicyRequest(t, conflict))
		if response.Code != 409 || !strings.Contains(response.Body.String(), `"error":"request_conflict"`) {
			t.Fatalf("purpose/version replay conflict = %d: %s", response.Code, response.Body.String())
		}
	}
	if upstream.calls != 1 {
		t.Fatalf("conflicting replay forwarded: %d", upstream.calls)
	}

	before := contextPolicyTrialCounts(t, db)
	stale := contextPolicyCall(engine, token, contextPolicyRequest(t, map[string]any{
		"client_request_id": "learning-stale-unseen",
		"purpose":           "learning",
		"policy_version":    1,
		"learning_source":   "pdd_detail_text",
	}))
	if stale.Code != 409 || !strings.Contains(stale.Body.String(), `"error":"policy_version_stale"`) {
		t.Fatalf("stale unseen request = %d: %s", stale.Code, stale.Body.String())
	}
	if after := contextPolicyTrialCounts(t, db); after != before || upstream.calls != 1 {
		t.Fatalf("stale request reserved quota: %d -> %d", before, after)
	}
}

func TestLingtuChatContextPolicyInputLimit(t *testing.T) {
	t.Run("policy-aware-text-over-limit", func(t *testing.T) {
		db, _, token, engine, upstream := newContextPolicyChat(t)
		body := contextPolicyRequest(t, map[string]any{
			"client_request_id": "oversized-text",
			"purpose":           "reply",
			"policy_version":    0,
			"messages":          contextPolicyMessages("user", strings.Repeat("汉", 10000), strings.Repeat("汉", 10000), strings.Repeat("汉", 10000), strings.Repeat("汉", 10000)),
		})
		response := contextPolicyCall(engine, token, body)
		if response.Code != 400 || !strings.Contains(response.Body.String(), `"error":"context_too_large"`) {
			t.Fatalf("oversized text = %d: %s", response.Code, response.Body.String())
		}
		if count := contextPolicyTrialCounts(t, db); count != 0 || upstream.calls != 0 {
			t.Fatalf("oversized text spent quota: %d %d", count, upstream.calls)
		}
	})

	t.Run("hidden-prompt-counted", func(t *testing.T) {
		db, _, token, engine, upstream := newContextPolicyChat(t)
		saveContextPolicyForTest(t, db, 0, func(input *lingtu.ContextPolicyInput) {
			input.RuntimeContext.Enabled = true
			input.RuntimeContext.SystemPrompt = strings.Repeat("密", 500)
		})
		body := contextPolicyRequest(t, map[string]any{
			"client_request_id": "oversized-hidden",
			"purpose":           "reply",
			"policy_version":    1,
			"messages":          contextPolicyMessages("user", strings.Repeat("汉", 9500), strings.Repeat("汉", 9500)),
		})
		response := contextPolicyCall(engine, token, body)
		if response.Code != 400 || !strings.Contains(response.Body.String(), `"error":"context_too_large"`) {
			t.Fatalf("hidden prompt not counted = %d: %s", response.Code, response.Body.String())
		}
		if count := contextPolicyTrialCounts(t, db); count != 0 || upstream.calls != 0 {
			t.Fatalf("hidden prompt overflow spent quota: %d %d", count, upstream.calls)
		}
	})

	t.Run("same-text-without-hidden-fits", func(t *testing.T) {
		_, _, token, engine, upstream := newContextPolicyChat(t)
		body := contextPolicyRequest(t, map[string]any{
			"client_request_id": "fits-without-hidden",
			"purpose":           "reply",
			"policy_version":    0,
			"messages":          contextPolicyMessages("user", strings.Repeat("汉", 9500), strings.Repeat("汉", 9500)),
		})
		response := contextPolicyCall(engine, token, body)
		if response.Code != 200 {
			t.Fatalf("text under the limit was rejected: %d: %s", response.Code, response.Body.String())
		}
		if upstream.calls != 1 {
			t.Fatalf("under-limit request calls = %d", upstream.calls)
		}
	})

	t.Run("legacy-text-keeps-existing-cap", func(t *testing.T) {
		_, _, token, engine, upstream := newContextPolicyChat(t)
		long := strings.Repeat("a ", 15000)
		body := contextPolicyRequest(t, map[string]any{
			"client_request_id": "legacy-no-new-cap",
			"messages":          contextPolicyMessages("user", long, long, long, long),
		})
		parsed, _, err := parseChat(strings.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		if countManagedTextTokens("deepseek-flash", parsed.Messages) <= managedChatTextLimit {
			t.Fatal("fixture must exceed the policy-aware text ceiling")
		}
		response := contextPolicyCall(engine, token, body)
		if response.Code != 200 {
			t.Fatalf("legacy request got a smaller cap: %d: %s", response.Code, response.Body.String())
		}
		if upstream.calls != 1 {
			t.Fatalf("legacy request calls = %d", upstream.calls)
		}
	})

	t.Run("legacy-hidden-rule-enforces-total-cap", func(t *testing.T) {
		db, _, token, engine, upstream := newContextPolicyChat(t)
		saveContextPolicyForTest(t, db, 0, func(input *lingtu.ContextPolicyInput) {
			input.RuntimeContext.Enabled = true
			input.RuntimeContext.SystemPrompt = "managed hidden rule"
		})
		long := strings.Repeat("a ", 15000)
		body := contextPolicyRequest(t, map[string]any{
			"client_request_id": "legacy-hidden-over-limit",
			"messages":          contextPolicyMessages("user", long, long, long, long),
		})
		response := contextPolicyCall(engine, token, body)
		if response.Code != 400 || !strings.Contains(response.Body.String(), `"error":"context_too_large"`) {
			t.Fatalf("legacy request bypassed enabled policy cap = %d: %s", response.Code, response.Body.String())
		}
		if count := contextPolicyTrialCounts(t, db); count != 0 || upstream.calls != 0 {
			t.Fatalf("legacy oversized request spent quota: %d %d", count, upstream.calls)
		}
	})

	t.Run("base64-image-not-counted-as-text", func(t *testing.T) {
		db, _, token, engine, upstream := newContextPolicyChat(t)
		if err := db.Model(&lingtu.ManagedAccount{}).Where("user_id = ?", 99).Update("model", visionModel).Error; err != nil {
			t.Fatal(err)
		}
		body := contextPolicyRequest(t, map[string]any{
			"client_request_id": "base64-not-text",
			"purpose":           "reply",
			"policy_version":    0,
			"messages": []map[string]any{
				{"role": "user", "content": []map[string]any{
					{"type": "text", "text": strings.Repeat("汉", 9500)},
					{"type": "image_url", "image_url": map[string]any{"url": contextPolicyPNG(t)}},
				}},
				{"role": "user", "content": strings.Repeat("汉", 9500)},
			},
		})
		response := contextPolicyCall(engine, token, body)
		if response.Code != 200 {
			t.Fatalf("base64 image counted as text: %d: %s", response.Code, response.Body.String())
		}
		if upstream.calls != 1 {
			t.Fatalf("image request calls = %d", upstream.calls)
		}
	})
}

func TestLingtuChatContextPolicyMalformedPolicy(t *testing.T) {
	db, _, token, engine, upstream := newContextPolicyChat(t)
	if err := db.Create(&lingtu.ManagedSetting{Name: lingtu.ContextPolicySettingName, Value: "not-valid-policy-json", Revision: 1}).Error; err != nil {
		t.Fatal(err)
	}
	legacy := contextPolicyCall(engine, token, contextPolicyRequest(t, map[string]any{"client_request_id": "malformed-legacy"}))
	if legacy.Code != 503 || !strings.Contains(legacy.Body.String(), `"error":"configuration_unavailable"`) {
		t.Fatalf("damaged policy must not bypass legacy reply rules: %d: %s", legacy.Code, legacy.Body.String())
	}
	for name, fields := range map[string]map[string]any{
		"explicit-reply":   {"client_request_id": "malformed-reply", "purpose": "reply"},
		"explicit-version": {"client_request_id": "malformed-version", "policy_version": 0},
	} {
		response := contextPolicyCall(engine, token, contextPolicyRequest(t, fields))
		if response.Code != 503 || !strings.Contains(response.Body.String(), `"error":"configuration_unavailable"`) {
			t.Fatalf("%s with damaged policy = %d: %s", name, response.Code, response.Body.String())
		}
	}
	if upstream.calls != 0 || contextPolicyTrialCounts(t, db) != 0 {
		t.Fatalf("calls with damaged policy reached upstream or quota: %d %d", upstream.calls, contextPolicyTrialCounts(t, db))
	}
}
