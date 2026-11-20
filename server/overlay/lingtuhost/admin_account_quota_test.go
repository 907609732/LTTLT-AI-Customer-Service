package lingtuhost

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
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

func batchQuotaTargetJSON(userID, expected, target int) map[string]any {
	return map[string]any{"user_id": userID, "expected_limit": expected, "target_calls": target}
}

func batchQuotaBody(t *testing.T, reason string, targets []map[string]any) string {
	t.Helper()
	body, err := common.Marshal(map[string]any{
		"section": "account", "action": "batch_quota", "reason": reason, "targets": targets,
	})
	require.NoError(t, err)
	return string(body)
}

func batchQuotaProof(t *testing.T, body string, identity service.AuthIdentity) string {
	t.Helper()
	digest := sha256.Sum256([]byte(body))
	context, err := common.Marshal(service.ManagedConfigurationContext{
		Section: "account", RequestHash: hex.EncodeToString(digest[:]),
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

func batchQuotaPost(t *testing.T, body string, identity service.AuthIdentity) *httptest.ResponseRecorder {
	t.Helper()
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest("POST", "/api/lingtu/admin/config", strings.NewReader(body))
	c.Request.Header.Set("X-Security-Proof", batchQuotaProof(t, body, identity))
	c.Set("auth_identity", identity)
	c.Set("id", identity.UserID)
	(&Host{}).saveConfig(c)
	return recorder
}

func batchQuotaUser(t *testing.T, db *gorm.DB, id, nativeStatus int) {
	t.Helper()
	require.NoError(t, db.Create(&model.User{
		Id: id, Username: fmt.Sprintf("batch-quota-%d", id), Password: "fixture-hash",
		Role: common.RoleCommonUser, Status: nativeStatus, AuthVersion: 1, Group: "default",
		AffCode: fmt.Sprintf("batch-quota-%d", id),
	}).Error)
}

func batchQuotaAccount(t *testing.T, db *gorm.DB, id, limit, used, reserved int) {
	t.Helper()
	now := time.Now()
	require.NoError(t, db.Create(&lingtu.ManagedAccount{UserID: id, Status: "enabled", Model: "managed-7"}).Error)
	require.NoError(t, db.Create(&lingtu.TrialGrant{
		UserID: id, Limit: limit, Used: used, Reserved: reserved,
		CreatedAt: now.Unix(), ExpiresAt: now.Add(24 * time.Hour).Unix(),
	}).Error)
}

func batchQuotaLimit(t *testing.T, db *gorm.DB, id int) lingtu.TrialGrant {
	t.Helper()
	var grant lingtu.TrialGrant
	require.NoError(t, db.First(&grant, "user_id = ?", id).Error)
	return grant
}

func TestLingtuAdminBatchQuotaHTTPAuthProofAndBinding(t *testing.T) {
	db := contextPolicyTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.UserAccessToken{}))
	batchQuotaUser(t, db, 301, common.UserStatusEnabled)
	batchQuotaAccount(t, db, 301, 100, 4, 1)
	_, commonToken := contextPolicyIdentity(t, db, 302, common.RoleCommonUser)
	adminIdentity, adminToken := contextPolicyIdentity(t, db, 303, common.RoleAdminUser)
	require.NoError(t, db.Create(&model.UserAccessToken{
		UserId: adminIdentity.UserID, Name: "fixture PAT",
		TokenHash: model.AccessTokenFingerprint("nap_batch_quota_fixture"),
		TokenHint: "nap_batc", ExpiresAt: time.Now().Add(time.Hour).Unix(),
	}).Error)

	router := gin.New()
	(&Host{}).registerAdmin(router)
	request := func(body, token, proof string) *httptest.ResponseRecorder {
		recorder := httptest.NewRecorder()
		req := httptest.NewRequest("POST", "/api/lingtu/admin/config", strings.NewReader(body))
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		if proof != "" {
			req.Header.Set("X-Security-Proof", proof)
		}
		router.ServeHTTP(recorder, req)
		return recorder
	}
	body := batchQuotaBody(t, "batch quota fixture", []map[string]any{batchQuotaTargetJSON(301, 100, 120)})
	proof := batchQuotaProof(t, body, adminIdentity)

	anonymous := request(body, "", proof)
	assert.Equal(t, http.StatusUnauthorized, anonymous.Code, anonymous.Body.String())
	commonRole := request(body, commonToken, proof)
	assert.Equal(t, http.StatusForbidden, commonRole.Code, commonRole.Body.String())
	apiKey := request(body, "nap_batch_quota_fixture", "")
	assert.Equal(t, http.StatusForbidden, apiKey.Code, apiKey.Body.String())
	noProof := request(body, adminToken, "")
	assert.Equal(t, http.StatusForbidden, noProof.Code, noProof.Body.String())
	assert.Equal(t, 100, batchQuotaLimit(t, db, 301).Limit)

	tampered := strings.Replace(body, `"target_calls":120`, `"target_calls":121`, 1)
	mismatch := request(tampered, adminToken, proof)
	assert.Equal(t, http.StatusForbidden, mismatch.Code, mismatch.Body.String())
	assert.Equal(t, 100, batchQuotaLimit(t, db, 301).Limit)

	accepted := request(body, adminToken, proof)
	require.Equal(t, http.StatusOK, accepted.Code, accepted.Body.String())
	assert.Equal(t, 120, batchQuotaLimit(t, db, 301).Limit)
	replay := request(body, adminToken, proof)
	assert.Equal(t, http.StatusForbidden, replay.Code, replay.Body.String())
	assert.Equal(t, 120, batchQuotaLimit(t, db, 301).Limit)
}

func TestLingtuAdminBatchQuotaStrictValidation(t *testing.T) {
	db := contextPolicyTestDB(t)
	batchQuotaUser(t, db, 311, common.UserStatusEnabled)
	batchQuotaAccount(t, db, 311, 100, 4, 2)
	identity, _ := contextPolicyIdentity(t, db, 312, common.RoleAdminUser)
	validTarget := batchQuotaTargetJSON(311, 100, 120)
	cases := []struct {
		name string
		body string
	}{
		{"unknown top field", `{"section":"account","action":"batch_quota","reason":"x","targets":[{"user_id":311,"expected_limit":100,"target_calls":120}],"extra":1}`},
		{"missing reason", `{"section":"account","action":"batch_quota","targets":[{"user_id":311,"expected_limit":100,"target_calls":120}]}`},
		{"blank reason", batchQuotaBody(t, "   ", []map[string]any{validTarget})},
		{"reason too long", batchQuotaBody(t, strings.Repeat("a", 181), []map[string]any{validTarget})},
		{"duplicate user", batchQuotaBody(t, "x", []map[string]any{validTarget, validTarget})},
		{"target too high", batchQuotaBody(t, "x", []map[string]any{batchQuotaTargetJSON(311, 100, 1000001)})},
		{"negative target", batchQuotaBody(t, "x", []map[string]any{batchQuotaTargetJSON(311, 100, -1)})},
		{"below used reserved", batchQuotaBody(t, "x", []map[string]any{batchQuotaTargetJSON(311, 100, 5)})},
		{"unknown target field", `{"section":"account","action":"batch_quota","reason":"x","targets":[{"user_id":311,"expected_limit":100,"target_calls":120,"model":"managed-x"}]}`},
		{"float target", `{"section":"account","action":"batch_quota","reason":"x","targets":[{"user_id":311,"expected_limit":100,"target_calls":120.5}]}`},
	}
	many := make([]map[string]any, 0, 21)
	for i := range 21 {
		many = append(many, batchQuotaTargetJSON(1000+i, 0, 1))
	}
	cases = append(cases, struct {
		name string
		body string
	}{"more than 20 targets", batchQuotaBody(t, "x", many)})

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			recorder := batchQuotaPost(t, tc.body, identity)
			assert.Equal(t, http.StatusBadRequest, recorder.Code, recorder.Body.String())
			assert.Equal(t, 100, batchQuotaLimit(t, db, 311).Limit)
		})
	}
}

func TestLingtuAdminBatchQuotaAtomicRollback(t *testing.T) {
	db := contextPolicyTestDB(t)
	batchQuotaUser(t, db, 321, common.UserStatusEnabled)
	batchQuotaAccount(t, db, 321, 100, 1, 0)
	batchQuotaUser(t, db, 322, common.UserStatusEnabled)
	// 322 exists natively but is not authorized and has no trial grant.
	identity, _ := contextPolicyIdentity(t, db, 323, common.RoleAdminUser)

	body := batchQuotaBody(t, "atomic fixture", []map[string]any{
		batchQuotaTargetJSON(321, 100, 120),
		batchQuotaTargetJSON(322, 0, 50),
	})
	response := batchQuotaPost(t, body, identity)
	assert.Equal(t, http.StatusBadRequest, response.Code, response.Body.String())
	assert.Equal(t, 100, batchQuotaLimit(t, db, 321).Limit)
	var accounts, grants int64
	require.NoError(t, db.Model(&lingtu.ManagedAccount{}).Where("user_id = ?", 322).Count(&accounts).Error)
	require.NoError(t, db.Model(&lingtu.TrialGrant{}).Where("user_id = ?", 322).Count(&grants).Error)
	assert.Zero(t, accounts)
	assert.Zero(t, grants)

	require.NoError(t, db.Model(&model.User{}).Where("id = ?", 322).Update("status", common.UserStatusDisabled).Error)
	batchQuotaAccount(t, db, 322, 50, 0, 0)
	body = batchQuotaBody(t, "atomic fixture", []map[string]any{
		batchQuotaTargetJSON(321, 100, 120),
		batchQuotaTargetJSON(322, 50, 60),
	})
	response = batchQuotaPost(t, body, identity)
	assert.Equal(t, http.StatusBadRequest, response.Code, response.Body.String())
	assert.Equal(t, 100, batchQuotaLimit(t, db, 321).Limit)
	assert.Equal(t, 50, batchQuotaLimit(t, db, 322).Limit)
}

func TestLingtuAdminBatchQuotaCASConflictRollsBackBatch(t *testing.T) {
	db := contextPolicyTestDB(t)
	batchQuotaUser(t, db, 331, common.UserStatusEnabled)
	batchQuotaAccount(t, db, 331, 100, 1, 0)
	batchQuotaUser(t, db, 332, common.UserStatusEnabled)
	batchQuotaAccount(t, db, 332, 80, 2, 0)
	identity, _ := contextPolicyIdentity(t, db, 333, common.RoleAdminUser)

	body := batchQuotaBody(t, "cas fixture", []map[string]any{
		batchQuotaTargetJSON(331, 100, 120),
		batchQuotaTargetJSON(332, 79, 90),
	})
	response := batchQuotaPost(t, body, identity)
	assert.Equal(t, http.StatusConflict, response.Code, response.Body.String())
	assert.Equal(t, 100, batchQuotaLimit(t, db, 331).Limit)
	assert.Equal(t, 80, batchQuotaLimit(t, db, 332).Limit)
}

func TestLingtuAdminBatchQuotaNoChangeAuditAndPreservesOtherLedgers(t *testing.T) {
	db := contextPolicyTestDB(t)
	batchQuotaUser(t, db, 341, common.UserStatusEnabled)
	batchQuotaAccount(t, db, 341, 100, 4, 2)
	now := time.Now().Unix()
	require.NoError(t, db.Create(&lingtu.PaidGrant{UserID: 341, Limit: 50, Used: 3, Reserved: 1, ExpiresAt: now + 3600, Epoch: 7}).Error)
	require.NoError(t, db.Create(&lingtu.PermanentGrant{UserID: 341, Limit: 30, Used: 5, Reserved: 2}).Error)
	require.NoError(t, db.Create(&model.UserSession{
		SID: "batch-quota-user-session", UserID: 341, Version: 1, UserAuthVersion: 1,
		Status: model.UserSessionStatusActive, RefreshHash: "fixture", LoginMethod: "password",
		ExpiresAt: now + 3600,
	}).Error)
	before := batchQuotaLimit(t, db, 341)
	identity, _ := contextPolicyIdentity(t, db, 342, common.RoleAdminUser)

	noChange := batchQuotaPost(t, batchQuotaBody(t, "no change fixture", []map[string]any{
		batchQuotaTargetJSON(341, 100, 100),
	}), identity)
	require.Equal(t, http.StatusOK, noChange.Code, noChange.Body.String())
	assert.Equal(t, before, batchQuotaLimit(t, db, 341))

	var audit lingtu.ManagedAudit
	require.NoError(t, db.Where("target_id = ? AND section = ?", 341, "account").Order("id DESC").First(&audit).Error)
	assert.Contains(t, audit.Reason, "before=100")
	assert.Contains(t, audit.Reason, "after=100")
	assert.LessOrEqual(t, len(audit.Reason), 256)
	assert.Equal(t, "success", audit.Outcome)

	changed := batchQuotaPost(t, batchQuotaBody(t, "preserve fixture", []map[string]any{
		batchQuotaTargetJSON(341, 100, 120),
	}), identity)
	require.Equal(t, http.StatusOK, changed.Code, changed.Body.String())
	after := batchQuotaLimit(t, db, 341)
	assert.Equal(t, 120, after.Limit)
	assert.Equal(t, before.Used, after.Used)
	assert.Equal(t, before.Reserved, after.Reserved)
	assert.Equal(t, before.ExpiresAt, after.ExpiresAt)
	var account lingtu.ManagedAccount
	require.NoError(t, db.First(&account, "user_id = ?", 341).Error)
	assert.Equal(t, "enabled", account.Status)
	assert.Equal(t, "managed-7", account.Model)
	var paid lingtu.PaidGrant
	var permanent lingtu.PermanentGrant
	require.NoError(t, db.First(&paid, "user_id = ?", 341).Error)
	require.NoError(t, db.First(&permanent, "user_id = ?", 341).Error)
	assert.Equal(t, lingtu.PaidGrant{UserID: 341, Limit: 50, Used: 3, Reserved: 1, ExpiresAt: now + 3600, Epoch: 7}, paid)
	assert.Equal(t, lingtu.PermanentGrant{UserID: 341, Limit: 30, Used: 5, Reserved: 2}, permanent)
	var sessions int64
	require.NoError(t, db.Model(&model.UserSession{}).Where("user_id = ? AND status = ?", 341, model.UserSessionStatusActive).Count(&sessions).Error)
	assert.EqualValues(t, 1, sessions)
}

func TestLingtuAdminBatchQuotaAuditFailureRollsBackUpdates(t *testing.T) {
	db := contextPolicyTestDB(t)
	if db.Dialector.Name() != "sqlite" {
		t.Skip("audit failure trigger is SQLite-specific")
	}
	batchQuotaUser(t, db, 351, common.UserStatusEnabled)
	batchQuotaAccount(t, db, 351, 100, 1, 0)
	identity, _ := contextPolicyIdentity(t, db, 352, common.RoleAdminUser)
	require.NoError(t, db.Exec(`CREATE TRIGGER batch_quota_audit_failure BEFORE INSERT ON lingtu_audits
		WHEN NEW.reason LIKE 'batch_quota before=%'
		BEGIN SELECT RAISE(ABORT, 'audit fixture failure'); END`).Error)

	response := batchQuotaPost(t, batchQuotaBody(t, "audit failure fixture", []map[string]any{
		batchQuotaTargetJSON(351, 100, 120),
	}), identity)
	assert.GreaterOrEqual(t, response.Code, 400)
	assert.Equal(t, 100, batchQuotaLimit(t, db, 351).Limit)
}

func TestLingtuAdminBatchQuotaConcurrentReserveDoesNotLoseCount(t *testing.T) {
	db := contextPolicyTestDB(t)
	batchQuotaUser(t, db, 361, common.UserStatusEnabled)
	batchQuotaAccount(t, db, 361, 10, 0, 0)
	identity, _ := contextPolicyIdentity(t, db, 362, common.RoleAdminUser)

	start := make(chan struct{})
	var response *httptest.ResponseRecorder
	var reserveErr error
	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		<-start
		response = batchQuotaPost(t, batchQuotaBody(t, "concurrent fixture", []map[string]any{
			batchQuotaTargetJSON(361, 10, 5),
		}), identity)
	}()
	go func() {
		defer wg.Done()
		<-start
		_, reserveErr = lingtu.NewTrialStore(db).Reserve(361, "batch-quota-concurrent", "digest", time.Now())
	}()
	close(start)
	wg.Wait()
	require.NoError(t, reserveErr)
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	grant := batchQuotaLimit(t, db, 361)
	assert.Equal(t, 5, grant.Limit)
	assert.Equal(t, 0, grant.Used)
	assert.Equal(t, 1, grant.Reserved)
	assert.LessOrEqual(t, grant.Used+grant.Reserved, grant.Limit)
}
