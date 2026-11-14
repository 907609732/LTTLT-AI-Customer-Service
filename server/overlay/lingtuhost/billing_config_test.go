package lingtuhost

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
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
	"github.com/stripe/stripe-go/v81"
)

func billingTestInput() billingSettingsRequest {
	return billingSettingsRequest{Section: "billing", Enabled: true, SecretKey: "sk_test_fixture_private", WebhookSecret: "whsec_fixture_private", Plans: []lingtu.BillingPlan{{ID: "sandbox", Name: "隔离测试套餐", Currency: "cny", Amount: 100, Calls: 5, ValidDays: 1}}}
}
func TestBillingAdminSettingsAreEncryptedRevisionedAndImmediatelyEffective(t *testing.T) {
	db := hostDB(t)
	h := &billingHost{db: db}
	input := billingTestInput()
	if err := h.saveBillingSettings(input, 101); err != nil {
		t.Fatal(err)
	}
	var raw string
	if err := db.Raw("SELECT value FROM lingtu_settings WHERE name = ?", "billing_stripe").Scan(&raw).Error; err != nil {
		t.Fatal(err)
	}
	if raw == "" || strings.Contains(raw, "sk_test_") || strings.Contains(raw, "whsec_") || strings.Contains(raw, "隔离测试套餐") {
		t.Fatal("billing configuration was not encrypted")
	}
	settings, source, err := loadBillingSettings(db)
	if err != nil || settings.Revision != 1 || settings.SecretKey != input.SecretKey || source != "database" {
		t.Fatalf("cannot read encrypted configuration: revision=%d source=%s err=%v", settings.Revision, source, err)
	}
	view, _ := json.Marshal(billingSettingsView(settings, source))
	if strings.Contains(string(view), input.SecretKey) || strings.Contains(string(view), input.WebhookSecret) {
		t.Fatal("admin response leaked credentials")
	}
	config, err := h.currentConfig()
	if err != nil || !config.Ready || len(config.Plans) != 1 {
		t.Fatal("saved config not visible without a restart")
	}
	if err := h.saveBillingSettings(input, 101); err != errBillingRevision {
		t.Fatal("stale revision overwrote billing configuration")
	}
	input.Revision = 1
	input.SecretKey = ""
	input.WebhookSecret = ""
	input.Plans[0].Amount = 200
	if err := h.saveBillingSettings(input, 101); err != nil {
		t.Fatal(err)
	}
	settings, _, err = loadBillingSettings(db)
	if err != nil || settings.Revision != 2 || settings.SecretKey != "sk_test_fixture_private" || settings.Plans[0].Amount != 200 {
		t.Fatal("blank credentials did not preserve encrypted values")
	}
}
func TestBillingAdminRejectsLiveAndClearingDoesNotFallBackToEnvironment(t *testing.T) {
	db := hostDB(t)
	h := &billingHost{db: db}
	input := billingTestInput()
	input.SecretKey = "sk_live_private"
	if err := h.saveBillingSettings(input, 1); err == nil {
		t.Fatal("test configuration accepted a live key")
	}
	input = billingTestInput()
	input.Plans[0].Amount = 0
	if err := h.saveBillingSettings(input, 1); err == nil {
		t.Fatal("invalid minor currency was accepted")
	}
	input = billingTestInput()
	if err := h.saveBillingSettings(input, 1); err != nil {
		t.Fatal(err)
	}
	t.Setenv("LINGTU_BILLING_STRIPE_SECRET_KEY", "sk_live_environment")
	t.Setenv("LINGTU_BILLING_STRIPE_WEBHOOK_SECRET", "whsec_environment")
	input.Revision = 1
	input.SecretKey = ""
	input.WebhookSecret = ""
	input.ClearSecretKey = true
	if err := h.saveBillingSettings(input, 1); err != nil {
		t.Fatal(err)
	}
	config, err := h.currentConfig()
	if err != nil || config.Ready || config.key != "" || len(config.Plans) != 0 {
		t.Fatal("cleared test settings fell back to environment or exposed plans")
	}
}
func TestBillingAdminCheckUsesOfficialSDKReadOnlyAndDoesNotCredit(t *testing.T) {
	db := hostDB(t)
	h := &billingHost{db: db, store: lingtu.NewBillingStore(db)}
	if err := h.store.Migrate(); err != nil {
		t.Fatal(err)
	}
	if err := h.saveBillingSettings(billingTestInput(), 1); err != nil {
		t.Fatal(err)
	}
	calls := 0
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.Method != "GET" || r.URL.Path != "/v1/account" || r.Header.Get("Authorization") != "Bearer sk_test_fixture_private" {
			t.Error("merchant check did not use the official read-only account operation")
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"id":"acct_fixture","object":"account"}`))
	}))
	defer upstream.Close()
	h.backend = stripe.GetBackendWithConfig(stripe.APIBackend, &stripe.BackendConfig{URL: stripe.String(upstream.URL), HTTPClient: upstream.Client(), LeveledLogger: &stripe.LeveledLogger{Level: stripe.LevelNull}})
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest("POST", "/check", nil)
	h.adminCheckBilling(c)
	if w.Code != 200 || calls != 1 || !strings.Contains(w.Body.String(), `"webhook":"not_verified"`) || !strings.Contains(w.Body.String(), `"payment":"not_tested"`) || strings.Contains(w.Body.String(), "private") {
		t.Fatalf("unsafe check result %d %s", w.Code, w.Body.String())
	}
	var credits, orders int64
	db.Model(&lingtu.BillingCredit{}).Count(&credits)
	db.Model(&lingtu.BillingOrder{}).Count(&orders)
	if credits != 0 || orders != 0 {
		t.Fatal("read-only merchant check created an order or credited calls")
	}
}
func TestBillingAdminWriteRequiresInteractiveSession(t *testing.T) {
	db := hostDB(t)
	h := &billingHost{db: db}
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	body, _ := json.Marshal(billingTestInput())
	c.Request = httptest.NewRequest("POST", "/api/lingtu/admin/billing", strings.NewReader(string(body)))
	h.adminSaveBilling(c)
	if w.Code != 403 {
		t.Fatalf("anonymous/PAT write status %d", w.Code)
	}
	var count int64
	db.Model(&lingtu.ManagedSetting{}).Where("name = ?", "billing_stripe").Count(&count)
	if count != 0 {
		t.Fatal("unverified administration persisted a merchant key")
	}
}

func TestBillingAdminWriteBindsExactBodyAndRejectsProofReplay(t *testing.T) {
	db := hostDB(t)
	h := &billingHost{db: db}
	if err := db.AutoMigrate(&model.User{}, &model.UserSession{}, &model.AuthFlow{}, &model.TwoFA{}, &model.PasskeyCredential{}); err != nil {
		t.Fatal(err)
	}
	user := model.User{Id: 101, Username: "billing-root-fixture", Password: "fixture-hash", Role: common.RoleRootUser, Status: common.UserStatusEnabled, AuthVersion: 1, Group: "default"}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	identity := service.AuthIdentity{UserID: 101, SessionID: "billing-save-fixture", UserAuthVersion: 1, SessionVersion: 1}
	if err := db.Create(&model.UserSession{SID: identity.SessionID, UserID: 101, Version: 1, UserAuthVersion: 1, Status: model.UserSessionStatusActive, RefreshHash: "fixture", LoginMethod: "password", ExpiresAt: time.Now().Add(time.Hour).Unix()}).Error; err != nil {
		t.Fatal(err)
	}
	body, _ := json.Marshal(billingTestInput())
	digest := sha256.Sum256(body)
	context, _ := json.Marshal(service.ManagedConfigurationContext{Section: "billing", RequestHash: hex.EncodeToString(digest[:])})
	binding, err := service.BindVerificationOperation(service.VerificationOperation{Scope: service.VerificationScopeManagedConfigure, Context: context})
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
		c.Request = httptest.NewRequest("POST", "/api/lingtu/admin/billing", strings.NewReader(raw))
		c.Request.Header.Set("X-Security-Proof", proof)
		c.Set("auth_identity", identity)
		c.Set("id", 101)
		h.adminSaveBilling(c)
		return w
	}
	changed := post(strings.Replace(string(body), `"enabled":true`, `"enabled":false`, 1))
	if changed.Code != 403 {
		t.Fatalf("different exact body accepted: %d", changed.Code)
	}
	w := post(string(body))
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"saved":true`) || strings.Contains(w.Body.String(), "fixture_private") {
		t.Fatalf("save result %d %s", w.Code, w.Body.String())
	}
	replayed := post(string(body))
	if replayed.Code != 403 {
		t.Fatalf("proof replay accepted: %d", replayed.Code)
	}
}

func TestBillingHTTPAuthenticatedCatalogAndOrdersUseSameRestrictedSession(t *testing.T) {
	db := hostDB(t)
	t.Setenv("LINGTU_BILLING_STRIPE_SECRET_KEY", "")
	t.Setenv("LINGTU_BILLING_STRIPE_WEBHOOK_SECRET", "")
	t.Setenv("LINGTU_BILLING_PLANS", "")
	vault, err := lingtu.RuntimeVault()
	if err != nil {
		t.Fatal(err)
	}
	// Only the native-session validation dependency is a fixture; token issue,
	// HTTP authentication, account authorization and ledger handlers are real.
	sessions := lingtu.NewSessionStore(db, vault, "https://api.example", func(int, string, int64) error { return nil })
	if err := sessions.Migrate(); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&accountUserFixture{ID: 42, DisplayName: "HTTP fixture"}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&lingtu.ManagedAccount{UserID: 42, Status: "enabled"}).Error; err != nil {
		t.Fatal(err)
	}
	trials := lingtu.NewTrialStore(db)
	if err := trials.Grant(42, time.Now(), 10, time.Hour); err != nil {
		t.Fatal(err)
	}
	bundle, err := sessions.Create(42, "billing-http-fixture", 1, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	host := &Host{sessions: sessions, trials: trials}
	router := gin.New()
	authenticated := router.Group("/api/client", host.clientAuth)
	if err := RegisterBilling(router, authenticated, db, "https://account.example"); err != nil {
		t.Fatal(err)
	}
	authenticated.GET("/me", host.me)
	server := httptest.NewServer(router)
	defer server.Close()
	for _, path := range []string{"/api/client/me", "/api/client/billing", "/api/client/billing/orders"} {
		request, _ := http.NewRequest("GET", server.URL+path, nil)
		request.Header.Set("Authorization", "Bearer "+bundle.AccessToken)
		response, err := server.Client().Do(request)
		if err != nil {
			t.Fatal(err)
		}
		var data map[string]interface{}
		err = json.NewDecoder(response.Body).Decode(&data)
		response.Body.Close()
		if response.StatusCode != 200 || err != nil {
			t.Fatalf("authenticated %s returned %d: %v", path, response.StatusCode, err)
		}
		if path == "/api/client/billing" && (data["ready"] != false || len(data["plans"].([]interface{})) != 0 || data["service"] == nil) {
			t.Fatal("unconfigured catalog impersonated a deployed merchant")
		}
	}
	if err := db.Model(&lingtu.ManagedAccount{}).Where("user_id = ?", 42).UpdateColumn("status", "disabled").Error; err != nil {
		t.Fatal(err)
	}
	request, _ := http.NewRequest("GET", server.URL+"/api/client/billing/orders", nil)
	request.Header.Set("Authorization", "Bearer "+bundle.AccessToken)
	response, err := server.Client().Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != 403 {
		t.Fatal("disabled account could query recharge orders")
	}
}
