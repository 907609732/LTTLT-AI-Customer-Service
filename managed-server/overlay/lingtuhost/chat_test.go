package lingtuhost

import (
	"bytes"
	"encoding/json"
	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/lingtu"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"io"
	"net/http"
	"net/http/httptest"
	"runtime/debug"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestLingtuBufferDoesNotDeliverBeforeAuthorizationRecheck(t *testing.T) {
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	capture := newRelayBuffer(context.Writer, 32)
	capture.WriteHeader(200)
	capture.WriteString("reply")
	if recorder.Body.Len() != 0 {
		t.Fatal("model output reached client before recheck")
	}
	if capture.Status() != 200 || !bytes.Equal(capture.body.Bytes(), []byte("reply")) {
		t.Fatal("model output not captured")
	}
	capture.Write(bytes.Repeat([]byte{'x'}, 64))
	if !capture.tooLarge {
		t.Fatal("unbounded model response")
	}
}

func TestLingtuChatRequestAndResponseAllowlist(t *testing.T) {
	in, _, err := parseChat(strings.NewReader(`{"client_request_id":"one","messages":[{"role":"user","content":"hello"}],"model":"evil","tools":[{}]}`))
	if err != nil || len(in.Messages) != 1 {
		t.Fatal(in, err)
	}
	if _, _, err = parseChat(strings.NewReader(`{"client_request_id":"one","messages":[{"role":"tool","content":"hello"}]}`)); err == nil {
		t.Fatal("tool accepted")
	}
	raw := []byte(`{"model":"provider-private","choices":[{"message":{"content":"answer","secret":"private"}}],"extra":"private","usage":{"prompt_tokens":2,"completion_tokens":3}}`)
	clean, input, output := sanitizeResponse(raw, "qwen-plus", "channel-key")
	if input != 2 || output != 3 || strings.Contains(string(clean), "private") || !strings.Contains(string(clean), "qwen-plus") {
		t.Fatal(string(clean), input, output)
	}
	if clean, _, _ := sanitizeResponse([]byte(`{"choices":[{"message":{"content":"channel-key"}}]}`), "qwen-plus", "channel-key"); len(clean) != 0 {
		t.Fatal("secret leaked")
	}
}

func TestLingtuChatLifecycle(t *testing.T) {
	for _, scenario := range []string{"success", "4xx", "mapped4xx", "5xx", "network", "before-start", "malformed", "panic", "revoke", "disable", "cache-failure"} {
		t.Run(scenario, func(t *testing.T) {
			db := chatFixtureDB(t)
			if err := db.Migrator().DropTable(&managedResult{}, &managedUsage{}); err != nil {
				t.Fatal(err)
			}
			if err := db.AutoMigrate(&model.Channel{}, &lingtu.ManagedSession{}); err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() {
				db.Migrator().DropTable(&managedResult{}, &managedUsage{}, &model.Channel{}, &lingtu.ManagedSession{})
			})
			vault, _ := lingtu.RuntimeVault()
			revoked := false
			sessions := lingtu.NewSessionStore(db, vault, "https://api.test", func(int, string, int64) error {
				if revoked {
					return lingtu.ErrSessionInvalid
				}
				return nil
			})
			h := &Host{sessions: sessions, trials: lingtu.NewTrialStore(db)}
			if err := h.migrateChat(); err != nil {
				t.Fatal(err)
			}
			if err := lingtu.EnsureManagedAccount(db, 99, time.Now()); err != nil {
				t.Fatal(err)
			}
			if err := db.Model(&lingtu.TrialGrant{}).Where("user_id = ?", 99).UpdateColumn("call_limit", 1).Error; err != nil {
				t.Fatal(err)
			}
			bundle, err := sessions.Create(99, "sid", 1, time.Now())
			if err != nil {
				t.Fatal(err)
			}
			channel := model.Channel{Name: "lingtu-deepseek", Type: 1, Status: 1, Key: "fixture-secret", Models: "deepseek-flash"}
			if err := db.Create(&channel).Error; err != nil {
				t.Fatal(err)
			}
			invocations := 0
			engine := gin.New()
			engine.POST("/chat", h.clientAuth, h.prepareChat, func(c *gin.Context) {
				invocations++
				if c.GetHeader("X-Evil") != "" || c.GetHeader("Authorization") != "" || c.Request.URL.RawQuery != "" || c.Request.URL.Path != "/v1/chat/completions" {
					t.Error("caller transport leaked")
				}
				raw, _ := io.ReadAll(c.Request.Body)
				var body map[string]any
				json.Unmarshal(raw, &body)
				if body["model"] != "deepseek-flash" || body["stream"] != false || body["max_tokens"] != float64(512) || body["tools"] != nil {
					t.Error(string(raw))
				}
				if scenario == "before-start" {
					c.AbortWithStatus(503)
					return
				}
				c.Set("lingtu_upstream_started", true)
				switch scenario {
				case "panic":
					panic("fixture")
				case "network":
					c.AbortWithStatus(502)
					return
				case "4xx":
					c.Set("lingtu_upstream_status", 400)
					c.AbortWithStatus(400)
					return
				case "5xx":
					c.Set("lingtu_upstream_status", 500)
					c.AbortWithStatus(500)
					return
				case "malformed":
					c.Set("lingtu_upstream_status", 200)
					c.String(200, "invalid")
					return
				case "revoke":
					revoked = true
				case "disable":
					db.Model(&lingtu.ManagedAccount{}).Where("user_id = ?", 99).UpdateColumn("status", "disabled")
				case "cache-failure":
					db.Migrator().DropTable(&managedResult{})
				}
				c.Set("lingtu_upstream_status", 200)
				if scenario == "mapped4xx" {
					c.Set("lingtu_upstream_status", 400)
				}
				c.JSON(200, gin.H{"choices": []gin.H{{"message": gin.H{"content": "safe answer"}}}, "usage": gin.H{"prompt_tokens": 2, "completion_tokens": 3}, "provider_secret": "hidden"})
			})
			call := func() *httptest.ResponseRecorder {
				r := httptest.NewRecorder()
				req := httptest.NewRequest("POST", "/chat?channel=999", strings.NewReader(`{"client_request_id":"one","model":"evil","messages":[{"role":"user","content":"hello"}],"tools":[{}]}`))
				req.Header.Set("Authorization", "Bearer "+bundle.AccessToken)
				req.Header.Set("Content-Type", "application/json")
				req.Header.Set("X-Evil", "root")
				engine.ServeHTTP(r, req)
				return r
			}
			response := call()
			expected := "uncertain"
			switch scenario {
			case "success", "revoke", "disable":
				expected = "success"
			case "4xx", "mapped4xx", "before-start":
				expected = "failed"
			}
			var ledger lingtu.TrialRequest
			if err := db.Where("user_id = ?", 99).First(&ledger).Error; err != nil || ledger.State != expected {
				t.Fatal(ledger, err)
			}
			var grant lingtu.TrialGrant
			db.First(&grant, 99)
			if expected == "success" && grant.Used != 1 || expected == "failed" && grant.Reserved != 0 || expected == "uncertain" && grant.Reserved != 1 {
				t.Fatal(grant)
			}
			if scenario == "success" {
				if response.Code != 200 || !strings.Contains(response.Body.String(), "safe answer") || strings.Contains(response.Body.String(), "hidden") {
					t.Fatal(response.Code, response.Body.String())
				}
				var cached managedResult
				db.First(&cached)
				if strings.Contains(string(cached.Payload), "safe answer") {
					t.Fatal("plaintext cache")
				}
				response = call()
				if response.Code != 200 || invocations != 1 {
					t.Fatal(response.Code, invocations)
				}
				db.Model(&managedResult{}).Where("user_id = ?", 99).UpdateColumn("expires_at", 0)
				if r := call(); r.Code != 410 {
					t.Fatal(r.Code, r.Body.String())
				}
			} else if strings.Contains(response.Body.String(), "safe answer") {
				t.Fatal("unauthorized output delivered")
			}
			if scenario == "revoke" && response.Code != 401 || scenario == "disable" && response.Code != 403 {
				t.Fatal(response.Code, response.Body.String())
			}
			if scenario != "success" && scenario != "revoke" && scenario != "disable" {
				_ = call()
				if invocations != 1 {
					t.Fatal("retried upstream", invocations)
				}
			}
		})
	}
}

func TestLingtuChatModelReadinessAndPendingDedupe(t *testing.T) {
	db := chatFixtureDB(t)
	vault, _ := lingtu.RuntimeVault()
	sessions := lingtu.NewSessionStore(db, vault, "https://api.test", func(int, string, int64) error { return nil })
	h := &Host{sessions: sessions, trials: lingtu.NewTrialStore(db)}
	if err := h.migrateChat(); err != nil {
		t.Fatal(err)
	}
	if err := lingtu.EnsureManagedAccount(db, 99, time.Now()); err != nil {
		t.Fatal(err)
	}
	engine := gin.New()
	forwarded := 0
	engine.POST("/chat", func(c *gin.Context) { c.Set("lingtu_identity", lingtu.ClientIdentity{UserID: 99}) }, h.prepareChat, func(c *gin.Context) { forwarded++; c.AbortWithStatus(500) })
	call := func(content string) *httptest.ResponseRecorder {
		r := httptest.NewRecorder()
		engine.ServeHTTP(r, httptest.NewRequest("POST", "/chat", strings.NewReader(`{"client_request_id":"one","messages":[{"role":"user","content":"`+content+`"}]}`)))
		return r
	}
	if r := call("hello"); r.Code != 503 || !strings.Contains(r.Body.String(), "model_not_ready") {
		t.Fatal(r.Code, r.Body.String())
	}
	var count int64
	db.Model(&lingtu.TrialRequest{}).Count(&count)
	if count != 0 {
		t.Fatal("readiness spent trial")
	}
	in, digest, _ := parseChat(strings.NewReader(`{"client_request_id":"one","messages":[{"role":"user","content":"hello"}]}`))
	if _, err := h.trials.ReserveWithLimits(99, in.RequestID, digest, time.Now(), lingtu.TrialLimits{1, 5, 4, 200}); err != nil {
		t.Fatal(err)
	}
	if r := call("hello"); r.Code != 409 || !strings.Contains(r.Body.String(), "request_pending") {
		t.Fatal(r.Code, r.Body.String())
	}
	if r := call("different"); r.Code != 409 || !strings.Contains(r.Body.String(), "request_conflict") {
		t.Fatal(r.Code, r.Body.String())
	}
	if forwarded != 0 {
		t.Fatal(forwarded)
	}
}

func chatFixtureDB(t *testing.T) *gorm.DB {
	t.Helper()
	db := hostDB(t)
	tables := []any{&managedResult{}, &managedUsage{}, "lingtu_trial_limit_gate", "lingtu_trial_daily_budgets", "lingtu_trial_limited_requests"}
	if err := db.Migrator().DropTable(tables...); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := db.Migrator().DropTable(tables...); err != nil {
			t.Error(err)
		}
	})
	return db
}

func TestLingtuNativeGatewayUsesPinnedChannel(t *testing.T) {
	// InitLogDB also initializes native SQL identifier quoting; keep it on this
	// already-verified isolated fixture connection and skip unrelated migrations.
	db := chatFixtureDB(t)
	oldLogDB, oldMaster, oldType := model.LOG_DB, common.IsMasterNode, common.MainDatabaseType()
	common.IsMasterNode = false
	switch db.Dialector.Name() {
	case "postgres":
		common.SetMainDatabaseType(common.DatabaseTypePostgreSQL)
	case "mysql":
		common.SetMainDatabaseType(common.DatabaseTypeMySQL)
	default:
		common.SetMainDatabaseType(common.DatabaseTypeSQLite)
	}
	t.Setenv("LOG_SQL_DSN", "")
	if err := model.InitLogDB(); err != nil {
		t.Fatal(err)
	}
	common.IsMasterNode = oldMaster
	t.Cleanup(func() { model.LOG_DB = oldLogDB; common.IsMasterNode = oldMaster; common.SetMainDatabaseType(oldType) })
	if err := db.Migrator().DropTable(&accountUserFixture{}); err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.User{}, &model.Token{}, &model.Channel{}, &model.Ability{}, &model.UserSubscription{}, &model.SubscriptionPlan{}, &lingtu.ManagedSession{}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		db.Migrator().DropTable(&model.Token{}, &model.Channel{}, &model.Ability{}, &model.UserSubscription{}, &model.SubscriptionPlan{}, &lingtu.ManagedSession{}, &model.User{})
	})
	root := model.User{Id: 1, Username: "fixture-root", Role: common.RoleRootUser, Status: common.UserStatusEnabled, Group: "default", Quota: 0}
	if err := db.Create(&root).Error; err != nil {
		t.Fatal(err)
	}
	vault, _ := lingtu.RuntimeVault()
	sessions := lingtu.NewSessionStore(db, vault, "https://api.test", func(int, string, int64) error { return nil })
	h := &Host{sessions: sessions, trials: lingtu.NewTrialStore(db)}
	if err := h.migrateChat(); err != nil {
		t.Fatal(err)
	}
	if err := lingtu.EnsureManagedAccount(db, 99, time.Now()); err != nil {
		t.Fatal(err)
	}
	bundle, err := sessions.Create(99, "native-fixture", 1, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	var invocations atomic.Int32
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		invocations.Add(1)
		if r.Header.Get("Authorization") != "Bearer fixture-provider-secret" || r.Header.Get("X-Evil") != "" {
			t.Error("wrong upstream headers")
		}
		w.Header().Set("Content-Type", "application/json")
		io.WriteString(w, `{"id":"fixture","object":"chat.completion","created":1,"model":"deepseek-flash","choices":[{"index":0,"message":{"role":"assistant","content":"native answer"},"finish_reason":"stop"}],"usage":{"prompt_tokens":2,"completion_tokens":3,"total_tokens":5}}`)
	}))
	defer provider.Close()
	base := provider.URL
	channel := model.Channel{Name: "lingtu-deepseek", Type: 1, Status: 1, Key: "fixture-provider-secret", Models: "deepseek-flash", Group: "default", BaseURL: &base}
	if err := db.Create(&channel).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.Ability{Group: "default", Model: "deepseek-flash", ChannelId: channel.Id, Enabled: true}).Error; err != nil {
		t.Fatal(err)
	}
	oldRedis := common.RedisEnabled
	common.RedisEnabled = false
	t.Cleanup(func() { common.RedisEnabled = oldRedis })
	oldMemory := common.MemoryCacheEnabled
	common.MemoryCacheEnabled = false
	t.Cleanup(func() { common.MemoryCacheEnabled = oldMemory })
	engine := gin.New()
	engine.POST("/chat", h.clientAuth, h.prepareChat, func(c *gin.Context) {
		defer func() {
			if p := recover(); p != nil {
				t.Log("native panic", p, string(debug.Stack()))
				panic(p)
			}
		}()
		c.Next()
		if b, ok := c.Writer.(*relayBuffer); ok && b.Status() >= 400 {
			t.Log("native fixture rejection", b.body.String())
		}
	}, h.injectInternalToken, middleware.TokenAuth(), middleware.Distribute(), h.nativeChat)
	request := httptest.NewRequest("POST", "/chat?channel=999", strings.NewReader(`{"client_request_id":"native-one","model":"evil","messages":[{"role":"user","content":"hello"}]}`))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Authorization", "Bearer "+bundle.AccessToken)
	request.Header.Set("X-Evil", "root")
	response := httptest.NewRecorder()
	engine.ServeHTTP(response, request)
	var rootAfter model.User
	if err := db.First(&rootAfter, root.Id).Error; err != nil || rootAfter.Quota != 0 || rootAfter.UsedQuota != 0 {
		t.Fatal("native billing debited root", rootAfter.Quota, rootAfter.UsedQuota, err)
	}
	retry := httptest.NewRequest("POST", "/chat", strings.NewReader(`{"client_request_id":"native-one","messages":[{"role":"user","content":"hello"}]}`))
	retry.Header.Set("Authorization", "Bearer "+bundle.AccessToken)
	retryResponse := httptest.NewRecorder()
	engine.ServeHTTP(retryResponse, retry)
	if retryResponse.Code != 200 || !strings.Contains(retryResponse.Body.String(), "native answer") || invocations.Load() != 1 {
		t.Fatalf("native retry forwarded: %d %s %d", retryResponse.Code, retryResponse.Body.String(), invocations.Load())
	}
	if response.Code != 200 || !strings.Contains(response.Body.String(), "native answer") || invocations.Load() != 1 {
		t.Fatalf("code=%d body=%s upstream=%d", response.Code, response.Body.String(), invocations.Load())
	}
}
