package lingtuhost

import (
	"bytes"
	"context"
	"crypto/tls"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/controller"
	"github.com/QuantumNous/new-api/lingtu"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"gorm.io/gorm"
)

type capturedProbeLog struct {
	mu   sync.Mutex
	data bytes.Buffer
}

func (b *capturedProbeLog) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.data.Write(p)
}
func (b *capturedProbeLog) String() string { b.mu.Lock(); defer b.mu.Unlock(); return b.data.String() }

func nativeProbeDB(t *testing.T) *gorm.DB {
	db := managedModelDB(t)
	if err := db.AutoMigrate(&model.User{}); err != nil {
		t.Fatal(err)
	}
	root := model.User{Id: 1, Username: "probe-root", Role: common.RoleRootUser, Status: common.UserStatusEnabled, Group: "default"}
	if err := db.Create(&root).Error; err != nil {
		t.Fatal(err)
	}
	return db
}
func TestLingtuReviewProbeNeverLogsProviderBodySecrets(t *testing.T) {
	nativeProbeDB(t)
	const sentinel = "probe-provider-secret-sentinel"
	for _, scenario := range []string{"json-error", "plain-error", "success-debug"} {
		t.Run(scenario, func(t *testing.T) {
			endpoint := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				switch scenario {
				case "json-error":
					w.WriteHeader(401)
					io.WriteString(w, `{"error":{"message":"`+sentinel+`","type":"auth"}}`)
				case "plain-error":
					w.WriteHeader(401)
					io.WriteString(w, sentinel)
				default:
					io.WriteString(w, `{"id":"fixture","object":"chat.completion","choices":[{"index":0,"message":{"role":"assistant","content":"`+sentinel+`"},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}`)
				}
			}))
			defer endpoint.Close()
			var logs capturedProbeLog
			common.LogWriterMu.Lock()
			oldOut, oldErr := gin.DefaultWriter, gin.DefaultErrorWriter
			gin.DefaultWriter = &logs
			gin.DefaultErrorWriter = &logs
			common.LogWriterMu.Unlock()
			oldDebug := common.DebugEnabled
			common.DebugEnabled = true
			defer func() {
				common.DebugEnabled = oldDebug
				common.LogWriterMu.Lock()
				gin.DefaultWriter = oldOut
				gin.DefaultErrorWriter = oldErr
				common.LogWriterMu.Unlock()
			}()
			channel := model.Channel{Name: "lingtu-managed-fixture", Type: 1, Key: sentinel, BaseURL: &endpoint.URL, Models: "fixture-model", Group: "default"}
			err := controller.TestManagedChannel(context.Background(), &channel, 1)
			if scenario != "success-debug" && err == nil {
				t.Fatal("provider failure accepted")
			}
			if err != nil && strings.Contains(err.Error(), sentinel) {
				t.Fatal("secret in returned error")
			}
			if strings.Contains(logs.String(), sentinel) {
				t.Fatal("provider secret appeared in captured native probe logs")
			}
		})
	}
}

func TestLingtuReviewExplicitEndpointNeverFallsBack(t *testing.T) {
	db := managedModelDB(t)
	for _, provider := range []string{"deepseek", "ollama"} {
		for _, base := range []string{"", " ", "\t"} {
			r := configurationRequest{Section: "model_connection", Provider: provider, Action: "save", Name: "explicit", Secret: "fixture", UpstreamModel: "fixture-model", BaseURL: base}
			if (&Host{}).saveModelConnection(nil, r) == nil {
				t.Errorf("blank explicit endpoint accepted for %s", provider)
			}
		}
	}
	var count int64
	db.Model(&model.Channel{}).Count(&count)
	if count != 0 {
		t.Fatal("invalid blank endpoint persisted", count)
	}
}

func savedReviewConnection(t *testing.T) (*gorm.DB, *Host, lingtu.ModelConnection, model.Channel) {
	t.Helper()
	db := managedModelDB(t)
	h := &Host{}
	if err := h.saveModelConnection(nil, configurationRequest{Section: "model_connection", Provider: "vllm", Action: "save", Name: "review", Secret: "fixture", BaseURL: "http://127.0.0.1:12345", UpstreamModel: "fixture-model", Enabled: true}); err != nil {
		t.Fatal(err)
	}
	var meta lingtu.ModelConnection
	db.First(&meta)
	var ch model.Channel
	db.First(&ch, meta.ChannelID)
	return db, h, meta, ch
}
func TestLingtuReviewFingerprintAllEffectiveNativeSettings(t *testing.T) {
	changes := map[string]func(*model.Channel){
		"headers":        func(ch *model.Channel) { value := `{"Authorization":"Bearer changed"}`; ch.HeaderOverride = &value },
		"proxy":          func(ch *model.Channel) { value := `{"proxy":"http://127.0.0.1:8999"}`; ch.Setting = &value },
		"organization":   func(ch *model.Channel) { value := "another-org"; ch.OpenAIOrganization = &value },
		"status_mapping": func(ch *model.Channel) { value := `{"401":"200"}`; ch.StatusCodeMapping = &value },
	}
	for name, change := range changes {
		t.Run(name, func(t *testing.T) {
			db, h, meta, ch := savedReviewConnection(t)
			r := configurationRequest{Action: "test", Provider: "vllm", ConnectionID: ch.Id}
			if err := h.executeModelConnection(nil, r, func(context.Context, *model.Channel, int) error { return nil }); err != nil {
				t.Fatal(err)
			}
			db.First(&ch, ch.Id)
			before := ch
			change(&ch)
			db.Save(&ch)
			if _, err := selectedChannel(meta.ModelID); err == nil {
				t.Error("modified native setting remained routable")
			}
			views, err := modelConnectionViews(db, "")
			if err != nil || len(views) != 1 || views[0].TestStatus != "stale" || views[0].Ready {
				t.Error("modified native setting did not stale test", err)
			}
			db.Save(&before)
			if err := h.executeModelConnection(nil, r, func(context.Context, *model.Channel, int) error { change(&before); return db.Save(&before).Error }); err == nil {
				t.Error("native mutation during probe accepted")
			}
		})
	}
}
func TestLingtuReviewTrialSelectionRequiresCurrentTest(t *testing.T) {
	db, h, meta, ch := savedReviewConnection(t)
	before, _ := lingtu.LoadTrialPolicy(db)
	if err := db.Transaction(func(tx *gorm.DB) error { return saveModelPolicy(tx, meta.ModelID) }); err == nil {
		t.Error("untested managed default accepted")
	}
	after, _ := lingtu.LoadTrialPolicy(db)
	if before != after {
		t.Error("rejected selection changed policy")
	}
	if err := h.executeModelConnection(nil, configurationRequest{Action: "test", Provider: "vllm", ConnectionID: ch.Id}, func(context.Context, *model.Channel, int) error { return nil }); err != nil {
		t.Fatal(err)
	}
	if err := db.Transaction(func(tx *gorm.DB) error { return saveModelPolicy(tx, meta.ModelID) }); err != nil {
		t.Fatal("tested selection rejected", err)
	}
	var stored model.Channel
	db.First(&stored, ch.Id)
	stored.Status = common.ChannelStatusManuallyDisabled
	db.Save(&stored)
	// Keeping the same current default permits unrelated policy changes.
	if err := db.Transaction(func(tx *gorm.DB) error { return saveModelPolicy(tx, meta.ModelID) }); err != nil {
		t.Fatal("unchanged default rejected", err)
	}
	request := configurationRequest{Calls: 20, Days: 7, DailyCalls: 200, MaxTokens: 512, Model: meta.ModelID}
	if err := h.saveTrialConfiguration(request); err != nil {
		t.Fatal("unchanged default policy edit rejected", err)
	}
	if err := db.Transaction(func(tx *gorm.DB) error { return saveModelPolicy(tx, "deepseek-flash") }); err != nil {
		t.Fatal(err)
	}
	if err := h.saveTrialConfiguration(request); err == nil {
		t.Fatal("trial entry accepted disabled managed selection")
	}
	stored.Status = common.ChannelStatusEnabled
	changed := `{"Authorization":"Bearer replacement"}`
	stored.HeaderOverride = &changed
	db.Save(&stored)
	if err := h.saveTrialConfiguration(request); err == nil {
		t.Fatal("trial entry accepted stale managed selection")
	}
	stored.HeaderOverride = nil
	db.Save(&stored)
	if err := h.saveTrialConfiguration(request); err != nil {
		t.Fatal("trial entry rejected current tested selection", err)
	}
}

// Real native Spark signs its fixed official URL; only the test dialer maps that
// socket to the isolated local TLS fixture. No provider traffic leaves this host.
func installSparkFixture(t *testing.T, mode func() string) *atomic.Int32 {
	t.Helper()
	calls := &atomic.Int32{}
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := (&websocket.Upgrader{}).Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer conn.Close()
		calls.Add(1)
		var input any
		if conn.ReadJSON(&input) != nil {
			return
		}
		switch mode() {
		case "business-error":
			conn.WriteMessage(websocket.TextMessage, []byte(`{"header":{"code":10013,"message":"spark-secret-sentinel"}}`))
		case "premature-close":
			return
		default:
			conn.WriteMessage(websocket.TextMessage, []byte(`{"header":{"code":0},"payload":{"choices":{"status":2,"text":[{"role":"assistant","content":"native answer"}]},"usage":{"text":{"prompt_tokens":2,"completion_tokens":3,"total_tokens":5}}}}`))
		}
	}))
	t.Cleanup(server.Close)
	old := websocket.DefaultDialer
	dialer := *old
	dialer.Proxy = nil
	dialer.TLSClientConfig = &tls.Config{InsecureSkipVerify: true}
	dialer.NetDialContext = func(ctx context.Context, network, address string) (net.Conn, error) {
		return (&net.Dialer{}).DialContext(ctx, "tcp", server.Listener.Addr().String())
	}
	websocket.DefaultDialer = &dialer
	t.Cleanup(func() { websocket.DefaultDialer = old })
	return calls
}
func TestLingtuReviewSparkNativeProbeTruthfulReadiness(t *testing.T) {
	for _, scenario := range []string{"business-error", "premature-close", "success"} {
		t.Run(scenario, func(t *testing.T) {
			db := nativeProbeDB(t)
			h := &Host{trials: lingtu.NewTrialStore(db)}
			if err := h.migrateChat(); err != nil {
				t.Fatal(err)
			}
			calls := installSparkFixture(t, func() string { return scenario })
			if err := h.saveModelConnection(nil, configurationRequest{Action: "save", Provider: "spark", Name: "Spark local fixture", Secret: "fixture-app|fixture-secret|fixture-key", BaseURL: "https://spark-api.xf-yun.com", UpstreamModel: "SparkDesk-v3.5", Enabled: true}); err != nil {
				t.Fatal(err)
			}
			var meta lingtu.ModelConnection
			db.First(&meta)
			c, _ := gin.CreateTestContext(httptest.NewRecorder())
			c.Request = httptest.NewRequest("POST", "/test", nil)
			c.Set("id", 1)
			err := h.saveModelConnection(c, configurationRequest{Action: "test", Provider: "spark", ConnectionID: meta.ChannelID})
			if scenario == "success" && err != nil {
				t.Fatal("valid native Spark probe rejected", err)
			}
			if scenario != "success" && err == nil {
				t.Fatal("rejected native Spark probe reported success")
			}
			var ch model.Channel
			db.First(&ch, meta.ChannelID)
			db.First(&meta, meta.ChannelID)
			if scenario != "success" {
				if ch.Status == common.ChannelStatusEnabled || meta.TestStatus != "failed" {
					t.Fatal("rejected Spark connection became ready")
				}
				if h.saveModelConnection(nil, configurationRequest{Action: "select", Provider: "spark", ConnectionID: meta.ChannelID}) == nil {
					t.Fatal("rejected Spark connection became selectable")
				}
			}
			var count int64
			db.Model(&managedUsage{}).Count(&count)
			if count != 0 {
				t.Fatal("Spark probe created customer usage")
			}
			if calls.Load() != 1 {
				t.Fatal("Spark probe retried or bypassed fixture", calls.Load())
			}
		})
	}
}
