package lingtuhost

import (
	"encoding/json"
	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/lingtu"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"io"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

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
