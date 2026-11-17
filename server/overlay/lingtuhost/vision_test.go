package lingtuhost

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/lingtu"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"image"
	"image/png"
	"io"
	"math/rand"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestLingtuKnowledgePNGTileInputIsBounded(t *testing.T) {
	picture := image.NewNRGBA(image.Rect(0, 0, 400, 400))
	_, _ = rand.New(rand.NewSource(1)).Read(picture.Pix)
	var buffer bytes.Buffer
	if err := png.Encode(&buffer, picture); err != nil {
		t.Fatal(err)
	}
	data := "data:image/png;base64," + base64.StdEncoding.EncodeToString(buffer.Bytes())
	input := `{"client_request_id":"knowledge-tile","messages":[{"role":"user","content":[{"type":"image_url","image_url":{"url":"` + data + `"}}]}]}`
	if len(input) <= 128*1024 {
		t.Fatal("fixture must exceed old body limit")
	}
	if _, _, err := parseChat(strings.NewReader(input)); err != nil {
		t.Fatalf("valid tile rejected: %v", err)
	}
	for _, bad := range []string{"data:image/png;base64,AAA", "data:image/svg+xml;base64,PHN2Zz4=", "data:image/png;base64," + base64.StdEncoding.EncodeToString([]byte("not a PNG"))} {
		if _, _, err := parseChat(strings.NewReader(strings.Replace(input, data, bad, 1))); err == nil {
			t.Fatal("invalid inline image accepted")
		}
	}
}

func TestLingtuVisionChatPartsAreCanonicalAndValidated(t *testing.T) {
	input := `{"client_request_id":"vision-1","messages":[{"role":"user","content":[{"type":"text","text":"图片是什么"},{"type":"image_url","image_url":{"url":"https://images.example.com/photo.png"}}]}]}`
	parsed, digest, err := parseChat(strings.NewReader(input))
	if err != nil {
		t.Fatalf("valid vision input rejected: %v", err)
	}
	raw, _ := json.Marshal(parsed.Messages)
	if !strings.Contains(string(raw), `"image_url"`) || digest == "" {
		t.Fatal("image lost or hash missing")
	}
	reordered := strings.Replace(input, `"type":"image_url","image_url":{"url":"https://images.example.com/photo.png"}`, `"image_url":{"url":"https://images.example.com/photo.png"},"type":"image_url"`, 1)
	_, same, err := parseChat(strings.NewReader(reordered))
	if err != nil || digest != same {
		t.Fatal("image key ordering must not change idempotency digest")
	}
	for _, bad := range []string{"http://images.example.com/a.png", "https://127.0.0.1/a.png", "https://user:pass@images.example.com/a.png", "https://images.example.com:9443/a.png", "data:image/png;base64,AAA", "https://host.local/a.png"} {
		if _, _, err := parseChat(strings.NewReader(strings.Replace(input, "https://images.example.com/photo.png", bad, 1))); err == nil {
			t.Fatalf("unsafe image accepted: %s", bad)
		}
	}
	if _, _, err := parseChat(strings.NewReader(strings.Replace(input, `"role":"user"`, `"role":"system"`, 1))); err == nil {
		t.Fatal("system multimodal input must be rejected")
	}
}

func TestLingtuVisionModelChannelAndCapabilityAreExplicit(t *testing.T) {
	db := managedModelDB(t)
	_ = db
	channel := qwenModelFixture()
	channel.Name = "lingtu-qwen-vision"
	channel.Models = visionModel
	if err := persistManagedModel(channel, true); err != nil {
		t.Fatalf("vision model channel not supported: %v", err)
	}
	if visionCapability(visionModel)["vision"] != true {
		t.Fatal("configured vision channel must advertise image input")
	}
	if visionCapability("qwen-plus")["vision"] != false {
		t.Fatal("text-only channel must not advertise vision")
	}
	channel.Status = 2
	if err := persistManagedModel(channel, false); err != nil {
		t.Fatal(err)
	}
	if visionCapability(visionModel)["vision"] != false {
		t.Fatal("disabled channel must remove image capability")
	}
}

func TestLingtuVisionCapabilityRecognizesConfiguredConnectionAliases(t *testing.T) {	db := managedModelDB(t)
	channel := qwenModelFixture()
	channel.Name = "vision-alias-test"
	channel.Models = visionModel
	if err := db.Create(channel).Error; err != nil {
		t.Fatal(err)
	}
	binding := lingtu.ModelConnection{ChannelID: channel.Id, Provider: "qwen", Name: "商品识图", ModelID: "managed-vision-test", Enabled: true, Revision: 1, ConfigHash: channelHash(*channel)}
	if err := db.Create(&binding).Error; err != nil {
		t.Fatal(err)
	}
	if visionCapability(binding.ModelID)["vision"] != true {
		t.Fatal("ready Qwen visual connection alias must advertise vision")
	}
}

func TestLingtuVisionInternalTokenUpgradeRejectsTampering(t *testing.T) {
	db := chatFixtureDB(t)
	db.Migrator().DropTable(&model.User{}, &model.Token{})
	if err := db.AutoMigrate(&model.User{}, &model.Token{}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Migrator().DropTable(&model.User{}, &model.Token{}) })
	root := model.User{Id: 1, Username: "vision-root", Role: common.RoleRootUser, Status: common.UserStatusEnabled}
	if err := db.Create(&root).Error; err != nil {
		t.Fatal(err)
	}
	token := model.Token{UserId: 1, Key: "fixture-token", Name: internalTokenName, Status: common.TokenStatusEnabled, UnlimitedQuota: true, ModelLimitsEnabled: true, ModelLimits: "deepseek-flash,qwen-plus", ExpiredTime: -1, Group: "default"}
	if err := db.Create(&token).Error; err != nil {
		t.Fatal(err)
	}
	next, err := resolveInternalToken()
	if err != nil || !strings.Contains(next.ModelLimits, visionModel) {
		t.Fatalf("existing trusted token not upgraded: %v", err)
	}
	db.Model(&model.Token{}).Where("id = ?", token.Id).Update("model_limits", "deepseek-flash,evil")
	if _, err := resolveInternalToken(); err == nil {
		t.Fatal("tampered token was silently accepted or repaired")
	}
}

func TestLingtuVisionGatewayKeepsImagesAndRequestLedger(t *testing.T) {
	for _, enabled := range []bool{true, false} {
		t.Run(map[bool]string{true: "vision", false: "text-only"}[enabled], func(t *testing.T) {
			db := chatFixtureDB(t)
			if err := db.AutoMigrate(&model.Channel{}, &lingtu.ManagedSession{}); err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { db.Migrator().DropTable(&model.Channel{}, &lingtu.ManagedSession{}) })
			vault, _ := lingtu.RuntimeVault()
			sessions := lingtu.NewSessionStore(db, vault, "https://api.test", func(int, string, int64) error { return nil })
			h := &Host{sessions: sessions, trials: lingtu.NewTrialStore(db)}
			if err := h.migrateChat(); err != nil {
				t.Fatal(err)
			}
			seedManagedChatIdentity(t, db)
			if err := lingtu.EnsureManagedAccount(db, 99, time.Now()); err != nil {
				t.Fatal(err)
			}
			bundle, err := sessions.Create(99, "vision-session", 1, time.Now())
			if err != nil {
				t.Fatal(err)
			}
			selected, name := visionModel, "lingtu-qwen-vision"
			if !enabled {
				selected = "deepseek-flash"
				name = "lingtu-deepseek"
			}
			db.Model(&lingtu.ManagedAccount{}).Where("user_id = ?", 99).Update("model", selected)
			if err := db.Create(&model.Channel{Name: name, Type: 1, Status: 1, Key: "fixture-secret", Models: selected}).Error; err != nil {
				t.Fatal(err)
			}
			router := gin.New()
			calls := 0
			router.GET("/me", h.clientAuth, h.me)
			router.POST("/chat", h.clientAuth, h.prepareChat, func(c *gin.Context) {
				calls++
				raw, _ := io.ReadAll(c.Request.Body)
				if !strings.Contains(string(raw), `"image_url"`) || !strings.Contains(string(raw), visionModel) {
					t.Fatal("actual model input lost image or model", string(raw))
				}
				c.Set("lingtu_upstream_started", true)
				c.Set("lingtu_upstream_status", 200)
				c.Set("lingtu_provider_usage_seen", true)
				c.Set("lingtu_provider_usage_known", true)
				c.Set("lingtu_provider_input_tokens", 2)
				c.Set("lingtu_provider_output_tokens", 3)
				c.JSON(200, gin.H{"choices": []gin.H{{"message": gin.H{"content": "image fixture answer"}}}, "usage": gin.H{"prompt_tokens": 2, "completion_tokens": 3}})
			})
			call := func(method, path, body string) *httptest.ResponseRecorder {
				r := httptest.NewRecorder()
				req := httptest.NewRequest(method, path, strings.NewReader(body))
				req.Header.Set("Authorization", "Bearer "+bundle.AccessToken)
				req.Header.Set("Content-Type", "application/json")
				router.ServeHTTP(r, req)
				return r
			}
			me := call("GET", "/me", "")
			var account map[string]any
			if json.Unmarshal(me.Body.Bytes(), &account) != nil || me.Code != 200 {
				t.Fatal(me.Code, me.Body.String())
			}
			if account["capabilities"].(map[string]any)["vision"] != enabled {
				t.Fatal("wrong account capability")
			}
			input := `{"client_request_id":"image-once","messages":[{"role":"user","content":[{"type":"text","text":"what"},{"type":"image_url","image_url":{"url":"https://images.example.com/a.png"}}]}]}`
			result := call("POST", "/chat", input)
			if !enabled {
				if result.Code != 400 || calls != 0 {
					t.Fatal("text model accepted image", result.Code, calls)
				}
				return
			}
			if result.Code != 200 {
				t.Fatal(result.Code, result.Body.String())
			}
			again := call("POST", "/chat", input)
			if again.Code != 200 || calls != 1 {
				t.Fatal("image was reissued", again.Code, calls)
			}
			conflict := call("POST", "/chat", strings.Replace(input, "a.png", "b.png", 1))
			if conflict.Code != 409 || calls != 1 {
				t.Fatal("changed image with same request ID was not blocked", conflict.Code, calls)
			}
			var grant lingtu.TrialGrant
			db.First(&grant, 99)
			if grant.Used != 1 || grant.Reserved != 0 {
				t.Fatal(grant)
			}
		})
	}
}

// The desktop never chooses a model. Text stays on the shipped default
// (DeepSeek) while image-bearing requests are routed to the allowed visual
// model, with the image parts preserved for the admitted upstream call.
func TestLingtuVisionAutoRoutesImagesAndKeepsTextOnDefault(t *testing.T) {
	db := managedModelDB(t)
	for _, channel := range []*model.Channel{
		{Name: "lingtu-deepseek", Type: 1, Group: "default", Models: "deepseek-flash", Status: common.ChannelStatusEnabled, Key: "fixture-deepseek"},
		{Name: "lingtu-qwen-vision", Type: 1, Group: "default", Models: visionModel, Status: common.ChannelStatusEnabled, Key: "fixture-vision"},
	} {
		if err := persistManagedModel(channel, false); err != nil {
			t.Fatal(err)
		}
	}
	h := &Host{trials: lingtu.NewTrialStore(db)}
	if err := h.migrateChat(); err != nil {
		t.Fatal(err)
	}
	seedManagedChatIdentity(t, db)
	if err := lingtu.EnsureManagedAccount(db, 99, time.Now()); err != nil {
		t.Fatal(err)
	}
	dispatched := []map[string]any{}
	router := gin.New()
	router.POST("/chat", func(c *gin.Context) { c.Set("lingtu_identity", lingtu.ClientIdentity{UserID: 99}) }, h.prepareChat, func(c *gin.Context) {
		raw, _ := io.ReadAll(c.Request.Body)
		var body map[string]any
		if err := json.Unmarshal(raw, &body); err != nil {
			t.Error(err)
		}
		dispatched = append(dispatched, body)
		// Reject at the isolated fake relay boundary: never contact a provider.
		c.AbortWithStatus(500)
	})
	call := func(body string) {
		t.Helper()
		router.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest("POST", "/chat", strings.NewReader(body)))
	}
	call(`{"client_request_id":"text","messages":[{"role":"user","content":"hi"}]}`)
	call(`{"client_request_id":"image","messages":[{"role":"user","content":[{"type":"text","text":"what"},{"type":"image_url","image_url":{"url":"https://images.example.com/a.png"}}]}]}`)
	if len(dispatched) != 2 {
		t.Fatalf("dispatched %d requests", len(dispatched))
	}
	if dispatched[0]["model"] != "deepseek-flash" {
		t.Fatalf("text routed to %v", dispatched[0]["model"])
	}
	if dispatched[1]["model"] != visionModel {
		t.Fatalf("image routed to %v", dispatched[1]["model"])
	}
	encoded, _ := json.Marshal(dispatched[1]["messages"])
	if !strings.Contains(string(encoded), `"image_url"`) {
		t.Fatalf("image parts lost: %s", encoded)
	}
	var usage managedUsage
	if err := db.First(&usage, "user_id = ? AND request_id = ?", 99, "image").Error; err != nil || usage.Model != visionModel || usage.UpstreamModel != visionModel {
		t.Fatal(usage, err)
	}
}

// An allowed scope without a ready visual model must fail closed before any
// quota reservation, and an explicit text model is never silently replaced.
func TestLingtuVisionRejectsImagesWithoutVisualRoute(t *testing.T) {
	db := managedModelDB(t)
	if err := persistManagedModel(&model.Channel{Name: "lingtu-deepseek", Type: 1, Group: "default", Models: "deepseek-flash", Status: common.ChannelStatusEnabled, Key: "fixture-deepseek"}, false); err != nil {
		t.Fatal(err)
	}
	policy := lingtu.DefaultTrialPolicy()
	policy.AllowedModels = []string{"deepseek-flash"}
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
	calls := 0
	router := gin.New()
	router.POST("/chat", func(c *gin.Context) { c.Set("lingtu_identity", lingtu.ClientIdentity{UserID: 99}) }, h.prepareChat, func(c *gin.Context) {
		calls++
		c.AbortWithStatus(500)
	})
	for _, body := range []string{
		`{"client_request_id":"image-auto","messages":[{"role":"user","content":[{"type":"text","text":"what"},{"type":"image_url","image_url":{"url":"https://images.example.com/a.png"}}]}]}`,
		`{"client_request_id":"image-explicit","model":"deepseek-flash","messages":[{"role":"user","content":[{"type":"text","text":"what"},{"type":"image_url","image_url":{"url":"https://images.example.com/a.png"}}]}]}`,
	} {
		recorder := httptest.NewRecorder()
		router.ServeHTTP(recorder, httptest.NewRequest("POST", "/chat", strings.NewReader(body)))
		if recorder.Code != 400 || !strings.Contains(recorder.Body.String(), `"error":"vision_unavailable"`) {
			t.Fatalf("image without visual route = %d: %s", recorder.Code, recorder.Body.String())
		}
	}
	if calls != 0 {
		t.Fatal("image reached an upstream model that cannot see it")
	}
	var count int64
	db.Model(&lingtu.TrialRequest{}).Count(&count)
	if count != 0 {
		t.Fatal("rejected image request reserved quota")
	}
}

// The account capability reflects the routed image model, not the text default.
func TestLingtuVisionAccountCapabilityFollowsImageRoute(t *testing.T) {
	db := managedModelDB(t)
	for _, channel := range []*model.Channel{
		{Name: "lingtu-deepseek", Type: 1, Group: "default", Models: "deepseek-flash", Status: common.ChannelStatusEnabled, Key: "fixture-deepseek"},
		{Name: "lingtu-qwen-vision", Type: 1, Group: "default", Models: visionModel, Status: common.ChannelStatusEnabled, Key: "fixture-vision"},
	} {
		if err := persistManagedModel(channel, false); err != nil {
			t.Fatal(err)
		}
	}
	seedManagedChatIdentity(t, db)
	if err := lingtu.EnsureManagedAccount(db, 99, time.Now()); err != nil {
		t.Fatal(err)
	}
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Set("lingtu_identity", lingtu.ClientIdentity{UserID: 99})
	(&Host{}).me(c)
	if recorder.Code != 200 {
		t.Fatal(recorder.Code, recorder.Body.String())
	}
	var account struct {
		Capabilities map[string]any `json:"capabilities"`
	}
	if json.Unmarshal(recorder.Body.Bytes(), &account) != nil {
		t.Fatal(recorder.Body.String())
	}
	if account.Capabilities["vision"] != true || account.Capabilities["model"] != "deepseek-flash" || account.Capabilities["max_images"] != float64(4) {
		t.Fatal(account.Capabilities)
	}
	if strings.Contains(recorder.Body.String(), "fixture-vision") || strings.Contains(recorder.Body.String(), "fixture-deepseek") {
		t.Fatal("provider credentials leaked in account projection")
	}
}

// The shipped text+visual pair keeps text on DeepSeek. If DeepSeek is not
// ready, text and free summaries fail closed instead of silently using the
// visual model; images still route to the visual model.
func TestLingtuVisionTextNeverFallsBackToVisualModel(t *testing.T) {
	db := managedModelDB(t)
	if err := persistManagedModel(&model.Channel{Name: "lingtu-qwen-vision", Type: 1, Group: "default", Models: visionModel, Status: common.ChannelStatusEnabled, Key: "fixture-vision"}, false); err != nil {
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
	relayed := []string{}
	terminal := func(c *gin.Context) {
		raw, _ := io.ReadAll(c.Request.Body)
		var body map[string]any
		if err := json.Unmarshal(raw, &body); err != nil {
			t.Error(err)
		}
		if modelName, ok := body["model"].(string); ok {
			relayed = append(relayed, modelName)
		}
		c.AbortWithStatus(500)
	}
	router := gin.New()
	router.POST("/chat", func(c *gin.Context) { c.Set("lingtu_identity", lingtu.ClientIdentity{UserID: 99}) }, h.prepareChat, terminal)
	router.POST("/summary", func(c *gin.Context) {
		c.Set("lingtu_identity", lingtu.ClientIdentity{UserID: 99})
		c.Set("lingtu_summary_input", chatInput{RequestID: "summary-pinned", Messages: []chatMessage{{Role: "user", Content: "history"}}})
	}, h.prepareChat, terminal)
	for _, call := range []struct{ path, body string }{
		{"/chat", `{"client_request_id":"text-pinned","messages":[{"role":"user","content":"hi"}]}`},
		{"/summary", `{}`},
	} {
		recorder := httptest.NewRecorder()
		router.ServeHTTP(recorder, httptest.NewRequest("POST", call.path, strings.NewReader(call.body)))
		if recorder.Code != 503 || !strings.Contains(recorder.Body.String(), `"error":"model_not_ready"`) {
			t.Fatalf("%s text fallback = %d: %s", call.path, recorder.Code, recorder.Body.String())
		}
	}
	if len(relayed) != 0 {
		t.Fatalf("text reached an upstream model: %v", relayed)
	}
	var count int64
	db.Model(&lingtu.TrialRequest{}).Count(&count)
	if count != 0 {
		t.Fatal("failed text or summary reserved quota")
	}
	// Images still use the ready visual model.
	image := `{"client_request_id":"image-pinned","messages":[{"role":"user","content":[{"type":"text","text":"what"},{"type":"image_url","image_url":{"url":"https://images.example.com/a.png"}}]}]}`
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest("POST", "/chat", strings.NewReader(image)))
	if len(relayed) != 1 || relayed[0] != visionModel {
		t.Fatalf("image route = %v", relayed)
	}
}

// Account capability keeps the text model name even when only the visual model
// is ready, so the desktop never mislabels text replies.
func TestLingtuVisionCapabilityKeepsTextModelWhenTextUnavailable(t *testing.T) {
	db := managedModelDB(t)
	if err := persistManagedModel(&model.Channel{Name: "lingtu-qwen-vision", Type: 1, Group: "default", Models: visionModel, Status: common.ChannelStatusEnabled, Key: "fixture-vision"}, false); err != nil {
		t.Fatal(err)
	}
	seedManagedChatIdentity(t, db)
	if err := lingtu.EnsureManagedAccount(db, 99, time.Now()); err != nil {
		t.Fatal(err)
	}
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Set("lingtu_identity", lingtu.ClientIdentity{UserID: 99})
	(&Host{}).me(c)
	if recorder.Code != 200 {
		t.Fatal(recorder.Code, recorder.Body.String())
	}
	var account struct {
		Capabilities map[string]any `json:"capabilities"`
	}
	if json.Unmarshal(recorder.Body.Bytes(), &account) != nil {
		t.Fatal(recorder.Body.String())
	}
	if account.Capabilities["model"] != "deepseek-flash" || account.Capabilities["vision"] != true {
		t.Fatal(account.Capabilities)
	}
	if strings.Contains(recorder.Body.String(), "fixture-vision") {
		t.Fatal("provider credential leaked")
	}
}
