package lingtuhost

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/lingtu"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relay/channel/openai"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/gin-gonic/gin"
)

func TestLingtuRejectedProviderContentRetainsReportedUsage(t *testing.T) {
	for _, scenario := range []string{"missing_content", "secret_content", "provider_400"} {
		t.Run(scenario, func(t *testing.T) {
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
			bundle, err := sessions.Create(99, "usage-rejection", 1, time.Now())
			if err != nil {
				t.Fatal(err)
			}
			if err := db.Create(&model.Channel{Name: "lingtu-deepseek", Type: 1, Status: 1, Key: "fixture-secret", Models: "deepseek-flash"}).Error; err != nil {
				t.Fatal(err)
			}
			engine := gin.New()
			engine.POST("/chat", h.clientAuth, h.prepareChat, func(c *gin.Context) {
				status := 200
				content := "fixture-secret"
				if scenario == "provider_400" {
					status = 400
					content = "private-provider-text"
				}
				message := map[string]any{"content": content}
				if scenario == "missing_content" {
					message = map[string]any{}
				}
				raw, _ := json.Marshal(map[string]any{"choices": []any{map[string]any{"message": message}}, "usage": map[string]any{"prompt_tokens": 2, "completion_tokens": 3}, "private": "never-deliver"})
				c.Set("lingtu_upstream_started", true)
				c.Set("lingtu_upstream_status", status)
				info := &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{ChannelType: 1, UpstreamModelName: "deepseek-flash"}, RelayFormat: types.RelayFormatOpenAI}
				response := &http.Response{StatusCode: status, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(string(raw)))}
				if _, err := openai.OpenaiHandler(c, info, response); err != nil {
					t.Fatal(err)
				}
			})
			response := httptest.NewRecorder()
			request := httptest.NewRequest("POST", "/chat", strings.NewReader(`{"client_request_id":"rejected","messages":[{"role":"user","content":"hello"}]}`))
			request.Header.Set("Authorization", "Bearer "+bundle.AccessToken)
			engine.ServeHTTP(response, request)
			if response.Code != 503 || strings.Contains(response.Body.String(), "fixture-secret") || strings.Contains(response.Body.String(), "private-provider-text") || strings.Contains(response.Body.String(), "never-deliver") {
				t.Fatal(response.Code, response.Body.String())
			}
			var usage managedUsage
			if err := db.Where("user_id = ? AND request_id = ?", 99, "rejected").First(&usage).Error; err != nil || !usage.UsageKnown || usage.InputTokens != 2 || usage.OutputTokens != 3 {
				t.Fatal("provider usage discarded with rejected content", usage, err)
			}
			var ledger lingtu.TrialRequest
			if err := db.Where("user_id = ? AND request_id = ?", 99, "rejected").First(&ledger).Error; err != nil {
				t.Fatal(err)
			}
			expected := "uncertain"
			if scenario == "provider_400" {
				expected = "failed"
			}
			if ledger.State != expected {
				t.Fatal(ledger.State, expected)
			}
			var cached int64
			if err := db.Model(&managedResult{}).Count(&cached).Error; err != nil || cached != 0 {
				t.Fatal("rejected reply cached", cached, err)
			}
		})
	}
}
