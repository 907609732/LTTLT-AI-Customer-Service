package lingtuhost

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/lingtu"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

const contextPolicyTestPrompt = "接待规则：只回答已审核内容。\n\"引用\" & <tag>"

func contextPolicyTestInput() lingtu.ContextPolicyInput {
	input := lingtu.DefaultContextPolicyInput()
	input.RuntimeContext.Enabled = true
	input.RuntimeContext.SystemPrompt = contextPolicyTestPrompt
	input.Learning.Enabled = true
	return input
}

// contextPolicyTestDB reuses the isolated SQLite host fixture, then installs the
// native dashboard user/session tables needed by AdminAuth and security proofs.
func contextPolicyTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db := hostDB(t)
	require.NoError(t, db.Migrator().DropTable("users"))
	require.NoError(t, db.AutoMigrate(
		&model.User{}, &model.UserSession{}, &model.AuthFlow{}, &model.TwoFA{},
		&model.PasskeyCredential{}, &model.Channel{}, &model.AuditLog{}, &model.Option{},
	))
	oldLogDB := model.LOG_DB
	oldType := common.MainDatabaseType()
	oldRedis := common.RedisEnabled
	oldSecret := common.SessionSecret
	oldCritical := common.CriticalRateLimitEnable
	model.LOG_DB = db
	common.SetMainDatabaseType(common.DatabaseTypeSQLite)
	common.RedisEnabled = false
	common.SessionSecret = "context-policy-test-session-secret"
	common.CriticalRateLimitEnable = false
	t.Cleanup(func() {
		model.LOG_DB = oldLogDB
		common.SetMainDatabaseType(oldType)
		common.RedisEnabled = oldRedis
		common.SessionSecret = oldSecret
		common.CriticalRateLimitEnable = oldCritical
	})
	return db
}

func contextPolicyIdentity(t *testing.T, db *gorm.DB, id, role int) (service.AuthIdentity, string) {
	t.Helper()
	user := model.User{
		Id: id, Username: fmt.Sprintf("context-policy-%d", id), Password: "fixture-hash",
		Role: role, Status: common.UserStatusEnabled, AuthVersion: 1, Group: "default",
		AffCode: fmt.Sprintf("context-policy-%d", id),
	}
	require.NoError(t, db.Create(&user).Error)
	identity := service.AuthIdentity{
		UserID: id, SessionID: fmt.Sprintf("context-policy-session-%d", id),
		UserAuthVersion: 1, SessionVersion: 1,
	}
	require.NoError(t, db.Create(&model.UserSession{
		SID: identity.SessionID, UserID: id, Version: 1, UserAuthVersion: 1,
		Status: model.UserSessionStatusActive, RefreshHash: "fixture",
		LoginMethod: "password", ExpiresAt: time.Now().Add(time.Hour).Unix(),
	}).Error)
	token, _, err := service.IssueAccessToken(identity)
	require.NoError(t, err)
	return identity, token
}

func contextPolicyBody(t *testing.T, revision int, input lingtu.ContextPolicyInput) string {
	t.Helper()
	body, err := common.Marshal(map[string]any{
		"section": "context_policy", "revision": revision, "context_policy": input,
	})
	require.NoError(t, err)
	return string(body)
}

func contextPolicyBodyWithField(t *testing.T, body, key string, value any) string {
	t.Helper()
	var payload map[string]any
	require.NoError(t, common.Unmarshal([]byte(body), &payload))
	payload[key] = value
	updated, err := common.Marshal(payload)
	require.NoError(t, err)
	return string(updated)
}

func contextPolicyBodyWithNestedField(t *testing.T, body, key string, value any) string {
	t.Helper()
	var payload map[string]any
	require.NoError(t, common.Unmarshal([]byte(body), &payload))
	candidate, ok := payload["context_policy"].(map[string]any)
	require.True(t, ok)
	candidate[key] = value
	updated, err := common.Marshal(payload)
	require.NoError(t, err)
	return string(updated)
}

func contextPolicyProof(t *testing.T, body string, identity service.AuthIdentity) string {
	t.Helper()
	digest := sha256.Sum256([]byte(body))
	context, err := common.Marshal(service.ManagedConfigurationContext{
		Section: "context_policy", RequestHash: hex.EncodeToString(digest[:]),
	})
	require.NoError(t, err)
	binding, err := service.BindVerificationOperation(service.VerificationOperation{
		Scope: service.VerificationScopeManagedConfigure, Context: context,
	})
	require.NoError(t, err)
	proof, _, err := service.IssueSecurityProof(identity, service.VerificationMethodPassword, binding)
	require.NoError(t, err)
	return proof
}

func postContextPolicy(t *testing.T, body string, identity service.AuthIdentity, proof string) *httptest.ResponseRecorder {
	t.Helper()
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest("POST", "/api/lingtu/admin/config", strings.NewReader(body))
	if proof != "" {
		c.Request.Header.Set("X-Security-Proof", proof)
	}
	c.Set("auth_identity", identity)
	c.Set("id", identity.UserID)
	(&Host{}).saveConfig(c)
	return recorder
}

func TestLingtuAdminContextPolicyAuth(t *testing.T) {
	db := contextPolicyTestDB(t)
	saved, err := lingtu.SaveContextPolicy(db, 0, contextPolicyTestInput())
	require.NoError(t, err)
	require.Equal(t, 1, saved.Revision)

	_, commonToken := contextPolicyIdentity(t, db, 101, common.RoleCommonUser)
	adminIdentity, adminToken := contextPolicyIdentity(t, db, 102, common.RoleAdminUser)
	router := gin.New()
	(&Host{}).registerAdmin(router)
	request := func(method, token, body string) *httptest.ResponseRecorder {
		recorder := httptest.NewRecorder()
		req := httptest.NewRequest(method, "/api/lingtu/admin/config", strings.NewReader(body))
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		router.ServeHTTP(recorder, req)
		return recorder
	}

	// The existing AdminAuth must reject a native common user and an anonymous
	// caller before the handler can return the editable prompt.
	commonRead := request("GET", commonToken, "")
	assert.Equal(t, http.StatusForbidden, commonRead.Code, commonRead.Body.String())
	assert.NotContains(t, commonRead.Body.String(), contextPolicyTestPrompt)
	assert.NotContains(t, commonRead.Body.String(), "context_policy")
	anonymousRead := request("GET", "", "")
	assert.Equal(t, http.StatusUnauthorized, anonymousRead.Code, anonymousRead.Body.String())

	adminRead := request("GET", adminToken, "")
	require.Equal(t, http.StatusOK, adminRead.Code, adminRead.Body.String())
	var payload struct {
		ContextPolicy lingtu.ManagedContextPolicy `json:"context_policy"`
	}
	require.NoError(t, common.Unmarshal(adminRead.Body.Bytes(), &payload))
	assert.Equal(t, 1, payload.ContextPolicy.Revision)
	assert.Equal(t, contextPolicyTestPrompt, payload.ContextPolicy.RuntimeContext.SystemPrompt)

	commonWrite := request("POST", commonToken, "{}")
	assert.Equal(t, http.StatusForbidden, commonWrite.Code, commonWrite.Body.String())

	// A native identity without a live interactive session cannot write. The
	// handler must reject it before reading a body or consuming a proof.
	withoutSession := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(withoutSession)
	c.Request = httptest.NewRequest("POST", "/api/lingtu/admin/config", strings.NewReader(contextPolicyBody(t, 1, contextPolicyTestInput())))
	c.Set("id", adminIdentity.UserID)
	(&Host{}).saveConfig(c)
	assert.Equal(t, http.StatusForbidden, withoutSession.Code)
	assert.Contains(t, withoutSession.Body.String(), "interactive_login_required")

	body := contextPolicyBody(t, 1, contextPolicyTestInput())
	withoutProof := postContextPolicy(t, body, adminIdentity, "")
	assert.Equal(t, http.StatusForbidden, withoutProof.Code)
	assert.Contains(t, withoutProof.Body.String(), "SECURITY_PROOF_REQUIRED")
	policy, err := lingtu.LoadContextPolicy(db)
	require.NoError(t, err)
	assert.Equal(t, 1, policy.Revision)
	var audits int64
	require.NoError(t, db.Model(&lingtu.ManagedAudit{}).Count(&audits).Error)
	assert.Zero(t, audits)
}

func TestLingtuAdminContextPolicySave(t *testing.T) {
	db := contextPolicyTestDB(t)
	identity, _ := contextPolicyIdentity(t, db, 201, common.RoleRootUser)
	input := contextPolicyTestInput()

	body := contextPolicyBody(t, 0, input)
	proof := contextPolicyProof(t, body, identity)
	tampered := contextPolicyTestInput()
	tampered.RuntimeContext.SystemPrompt = "篡改后的策略"
	tamperedBody := contextPolicyBody(t, 0, tampered)
	mismatch := postContextPolicy(t, tamperedBody, identity, proof)
	assert.Equal(t, http.StatusForbidden, mismatch.Code, mismatch.Body.String())
	unsaved, err := lingtu.LoadContextPolicy(db)
	require.NoError(t, err)
	assert.Equal(t, 0, unsaved.Revision)
	assert.Empty(t, unsaved.RuntimeContext.SystemPrompt)

	response := postContextPolicy(t, body, identity, proof)
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	var result struct {
		Saved         bool                        `json:"saved"`
		ContextPolicy lingtu.ManagedContextPolicy `json:"context_policy"`
	}
	require.NoError(t, common.Unmarshal(response.Body.Bytes(), &result))
	assert.True(t, result.Saved)
	assert.Equal(t, 1, result.ContextPolicy.Revision)
	assert.Equal(t, contextPolicyTestPrompt, result.ContextPolicy.RuntimeContext.SystemPrompt)

	var audit lingtu.ManagedAudit
	require.NoError(t, db.Order("id DESC").First(&audit).Error)
	assert.Equal(t, identity.UserID, audit.ActorID)
	assert.Equal(t, "context_policy", audit.Section)
	assert.Equal(t, "success", audit.Outcome)
	assert.NotContains(t, fmt.Sprint(audit), contextPolicyTestPrompt)

	for name, invalid := range map[string]string{
		"unknown top-level field": contextPolicyBodyWithField(t, contextPolicyBody(t, 1, input), "unexpected", true),
		"unknown nested field":    contextPolicyBodyWithNestedField(t, contextPolicyBody(t, 1, input), "unknown_nested", true),
	} {
		t.Run(name, func(t *testing.T) {
			rejected := postContextPolicy(t, invalid, identity, contextPolicyProof(t, invalid, identity))
			assert.Equal(t, http.StatusBadRequest, rejected.Code, rejected.Body.String())
		})
	}

	invalidInput := contextPolicyTestInput()
	invalidInput.Learning.RequiresReview = false
	invalidBody := contextPolicyBody(t, 1, invalidInput)
	invalid := postContextPolicy(t, invalidBody, identity, contextPolicyProof(t, invalidBody, identity))
	assert.Equal(t, http.StatusBadRequest, invalid.Code, invalid.Body.String())

	policy, err := lingtu.LoadContextPolicy(db)
	require.NoError(t, err)
	assert.Equal(t, 1, policy.Revision)
	assert.Equal(t, contextPolicyTestPrompt, policy.RuntimeContext.SystemPrompt)
}

func TestLingtuAdminContextPolicyConflict(t *testing.T) {
	db := contextPolicyTestDB(t)
	identity, _ := contextPolicyIdentity(t, db, 301, common.RoleRootUser)

	first := contextPolicyTestInput()
	firstBody := contextPolicyBody(t, 0, first)
	require.Equal(t, http.StatusOK, postContextPolicy(t, firstBody, identity, contextPolicyProof(t, firstBody, identity)).Code)

	second := contextPolicyTestInput()
	second.RuntimeContext.SystemPrompt = "第二版已审核接待规则"
	secondBody := contextPolicyBody(t, 1, second)
	require.Equal(t, http.StatusOK, postContextPolicy(t, secondBody, identity, contextPolicyProof(t, secondBody, identity)).Code)

	stale := contextPolicyTestInput()
	stale.RuntimeContext.SystemPrompt = "旧修订号不得覆盖"
	staleBody := contextPolicyBody(t, 0, stale)
	conflict := postContextPolicy(t, staleBody, identity, contextPolicyProof(t, staleBody, identity))
	require.Equal(t, http.StatusConflict, conflict.Code, conflict.Body.String())
	var result struct {
		Error    string `json:"error"`
		Revision int    `json:"revision"`
	}
	require.NoError(t, common.Unmarshal(conflict.Body.Bytes(), &result))
	assert.Equal(t, "revision_conflict", result.Error)
	assert.Equal(t, 2, result.Revision)
	assert.NotContains(t, conflict.Body.String(), second.RuntimeContext.SystemPrompt)

	policy, err := lingtu.LoadContextPolicy(db)
	require.NoError(t, err)
	assert.Equal(t, 2, policy.Revision)
	assert.Equal(t, second.RuntimeContext.SystemPrompt, policy.RuntimeContext.SystemPrompt)

	var audit lingtu.ManagedAudit
	require.NoError(t, db.Order("id DESC").First(&audit).Error)
	assert.Equal(t, "context_policy", audit.Section)
	assert.Equal(t, "failed_or_unconfirmed", audit.Outcome)
}

func TestLingtuAdminContextPolicyDatabaseFailures(t *testing.T) {
	db := contextPolicyTestDB(t)
	identity, _ := contextPolicyIdentity(t, db, 401, common.RoleRootUser)
	input := contextPolicyTestInput()
	_, err := lingtu.SaveContextPolicy(db, 0, input)
	require.NoError(t, err)

	const updateFailure = "fixture-fail-context-policy-update"
	require.NoError(t, db.Callback().Update().Before("gorm:update").Register(updateFailure, func(tx *gorm.DB) {
		if tx.Statement.Table == "lingtu_settings" {
			tx.AddError(errors.New("fixture context policy update failure"))
		}
	}))
	body := contextPolicyBody(t, 1, input)
	failedSave := postContextPolicy(t, body, identity, contextPolicyProof(t, body, identity))
	assert.Equal(t, http.StatusServiceUnavailable, failedSave.Code, failedSave.Body.String())
	assert.NotContains(t, failedSave.Body.String(), contextPolicyTestPrompt)
	db.Callback().Update().Remove(updateFailure)

	// adminConfig reads the trial policy first and the context policy second.
	// Fail only the second encrypted-settings read so the regression covers the
	// new policy load rather than the pre-existing trial policy guard.
	const queryFailure = "fixture-fail-context-policy-read"
	settingsReads := 0
	require.NoError(t, db.Callback().Query().Before("gorm:query").Register(queryFailure, func(tx *gorm.DB) {
		if tx.Statement.Table == "lingtu_settings" {
			settingsReads++
			if settingsReads == 2 {
				tx.AddError(errors.New("fixture context policy read failure"))
			}
		}
	}))
	t.Cleanup(func() { db.Callback().Query().Remove(queryFailure) })
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest("GET", "/api/lingtu/admin/config", nil)
	(&Host{}).adminConfig(c)
	assert.Equal(t, http.StatusServiceUnavailable, recorder.Code, recorder.Body.String())
	assert.NotContains(t, recorder.Body.String(), contextPolicyTestPrompt)
}
