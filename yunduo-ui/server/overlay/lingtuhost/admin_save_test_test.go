package lingtuhost

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/lingtu"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// Removing the save-and-probe bridge must fail these tests: the one authorized
// operation must persist first, return its exact ID and probe that saved row once.
func TestLingtuConnectionSaveAndTest(t *testing.T) {
	for _, failure := range []bool{false, true} {
		t.Run(map[bool]string{false: "success", true: "failed"}[failure], func(t *testing.T) {
			db := managedModelDB(t)
			before := putModelPolicy(t, db)
			c, _ := gin.CreateTestContext(httptest.NewRecorder())
			c.Request = httptest.NewRequest("POST", "/api/lingtu/admin/config", nil)
			r := connectionRequest(t, `{"section":"model_connection","action":"save","test_after_save":true,"provider":"vllm","name":"new API","base_url":"http://127.0.0.1:12345","upstream_model":"fixture-model","secret":"private-fixture","enabled":true}`)
			probes := 0
			err := (&Host{}).executeModelConnection(c, r, func(_ context.Context, ch *model.Channel, _ int) error {
				probes++
				var stored model.Channel
				if ch.Id <= 0 || db.First(&stored, ch.Id).Error != nil || stored.Key != "private-fixture" {
					t.Fatal("probe did not use persisted new connection")
				}
				if failure {
					return errors.New("private-fixture upstream error")
				}
				return nil
			})
			if (err != nil) != failure || probes != 1 {
				t.Fatalf("save/test result=%v probes=%d", err, probes)
			}
			id := c.GetInt("lingtu_saved_connection_id")
			if id <= 0 || !c.GetBool("lingtu_connection_saved") {
				t.Fatal("new persisted ID missing")
			}
			var row lingtu.ModelConnection
			var channel model.Channel
			if db.First(&row, id).Error != nil || db.First(&channel, id).Error != nil {
				t.Fatal("saved row missing")
			}
			if failure && (row.TestStatus != "failed" || channel.Status != common.ChannelStatusManuallyDisabled) {
				t.Fatal("failed configuration was enabled or discarded")
			}
			if !failure && (row.TestStatus != "success" || channel.Status != common.ChannelStatusEnabled) {
				t.Fatal("successful saved configuration not tested")
			}
			after, _ := lingtu.LoadTrialPolicy(db)
			if before != after {
				t.Fatal("save and test switched default")
			}
		})
	}
}

func TestLingtuConnectionSaveAndTestExactProofAndHTTPResult(t *testing.T) {
	db := managedModelDB(t)
	if err := db.AutoMigrate(&model.User{}, &model.UserSession{}, &model.AuthFlow{}, &model.TwoFA{}, &model.PasskeyCredential{}); err != nil {
		t.Fatal(err)
	}
	user := model.User{Id: 101, Username: "save-test-root", Password: "fixture-hash", Role: common.RoleRootUser, Status: common.UserStatusEnabled, AuthVersion: 1, Group: "default"}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	identity := service.AuthIdentity{UserID: 101, SessionID: "save-test-session", UserAuthVersion: 1, SessionVersion: 1}
	if err := db.Create(&model.UserSession{SID: identity.SessionID, UserID: 101, Version: 1, UserAuthVersion: 1, Status: model.UserSessionStatusActive, RefreshHash: "fixture", LoginMethod: "password", ExpiresAt: time.Now().Add(time.Hour).Unix()}).Error; err != nil {
		t.Fatal(err)
	}
	var calls atomic.Int32
	endpoint := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(401)
		io.WriteString(w, `{"error":{"message":"private-fixture-upstream-body"}}`)
	}))
	defer endpoint.Close()
	body := fmt.Sprintf(`{"section":"model_connection","action":"save","test_after_save":true,"provider":"vllm","connection_id":0,"name":"new API","base_url":%q,"upstream_model":"fixture-model","secret":"private-fixture-key","enabled":true}`, endpoint.URL)
	digest := sha256.Sum256([]byte(body))
	ctx, _ := json.Marshal(service.ManagedConfigurationContext{Section: "model_connection", RequestHash: hex.EncodeToString(digest[:])})
	binding, err := service.BindVerificationOperation(service.VerificationOperation{Scope: service.VerificationScopeManagedConfigure, Context: ctx})
	if err != nil {
		t.Fatal(err)
	}
	proof, _, err := service.IssueSecurityProof(identity, service.VerificationMethodPassword, binding)
	if err != nil {
		t.Fatal(err)
	}
	post := func(raw string) *httptest.ResponseRecorder {
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Request = httptest.NewRequest("POST", "/api/lingtu/admin/config", strings.NewReader(raw))
		c.Request.Header.Set("X-Security-Proof", proof)
		c.Set("auth_identity", identity)
		c.Set("id", 101)
		(&Host{}).saveConfig(c)
		return w
	}
	// A proof for test_after_save:true cannot authorize different bytes, including
	// an ordinary save or a changed credential. Rejection must precede persistence.
	changed := post(strings.Replace(body, `"test_after_save":true`, `"test_after_save":false`, 1))
	if changed.Code != 403 || calls.Load() != 0 {
		t.Fatalf("changed body was accepted: code=%d calls=%d", changed.Code, calls.Load())
	}
	var count int64
	db.Model(&lingtu.ModelConnection{}).Count(&count)
	if count != 0 {
		t.Fatal("proof mismatch persisted configuration")
	}
	response := post(body)
	var result struct {
		Saved       bool                  `json:"saved"`
		Tested      bool                  `json:"tested"`
		ID          int                   `json:"connection_id"`
		Connections []modelConnectionView `json:"model_connections"`
	}
	if json.Unmarshal(response.Body.Bytes(), &result) != nil || response.Code != 400 || !result.Saved || result.Tested || result.ID <= 0 || len(result.Connections) != 1 || result.Connections[0].ConnectionID != result.ID || result.Connections[0].TestStatus != "failed" || calls.Load() != 1 {
		t.Fatalf("saved-but-failed response invalid: code=%d id=%d calls=%d", response.Code, result.ID, calls.Load())
	}
	if strings.Contains(response.Body.String(), "private-fixture") {
		t.Fatal("save/test result exposed provider credential or body")
	}
	replay := post(body)
	if replay.Code != 403 || calls.Load() != 1 {
		t.Fatal("single-use proof authorized repeated probe")
	}
}

func TestLingtuConnectionSaveAndTestValidationAndStaleNeverProbe(t *testing.T) {
	db := managedModelDB(t)
	h := &Host{}
	base := connectionRequest(t, `{"section":"model_connection","action":"save","provider":"vllm","name":"local","base_url":"http://127.0.0.1:12345","upstream_model":"fixture-model","enabled":true}`)
	if err := h.saveModel(nil, base); err != nil {
		t.Fatal(err)
	}
	var row lingtu.ModelConnection
	db.First(&row)
	for _, raw := range []string{
		`{"section":"model_connection","action":"save","test_after_save":true,"provider":"vllm","name":"","upstream_model":"fixture-model"}`,
		`{"section":"model_connection","action":"save","test_after_save":true,"provider":"vllm","connection_id":1,"revision":99,"name":"stale","base_url":"http://127.0.0.1:12345","upstream_model":"fixture-model","enabled":true}`,
	} {
		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		r := connectionRequest(t, raw)
		if err := h.executeModelConnection(c, r, func(context.Context, *model.Channel, int) error { t.Fatal("invalid/stale save probed"); return nil }); err == nil {
			t.Fatal("invalid/stale save accepted")
		}
		if c.GetBool("lingtu_connection_saved") {
			t.Fatal("failed save claimed persisted")
		}
	}
}

func TestLingtuConnectionSaveAndTestPersistenceFailureNeverProbes(t *testing.T) {
	db := managedModelDB(t)
	if err := db.Callback().Create().Before("gorm:create").Register("fixture-fail-binding", func(tx *gorm.DB) {
		if tx.Statement.Table == "lingtu_model_connections" {
			tx.AddError(errors.New("fixture persist failure"))
		}
	}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Callback().Create().Remove("fixture-fail-binding") })
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	r := connectionRequest(t, `{"section":"model_connection","action":"save","test_after_save":true,"provider":"vllm","name":"local","base_url":"http://127.0.0.1:12345","upstream_model":"fixture-model","enabled":true}`)
	err := (&Host{}).executeModelConnection(c, r, func(context.Context, *model.Channel, int) error {
		t.Fatal("failed persistence issued probe")
		return nil
	})
	if err == nil || c.GetBool("lingtu_connection_saved") {
		t.Fatal("failed persistence claimed saved")
	}
	var count int64
	db.Model(&model.Channel{}).Count(&count)
	if count != 0 {
		t.Fatal("failed binding left a partial channel")
	}
}
