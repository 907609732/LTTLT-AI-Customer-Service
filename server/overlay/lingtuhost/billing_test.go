package lingtuhost

import (
	"bytes"
	"encoding/json"
	"github.com/QuantumNous/new-api/lingtu"
	"github.com/gin-gonic/gin"
	"github.com/stripe/stripe-go/v81"
	"github.com/stripe/stripe-go/v81/webhook"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestBillingConfigurationFailsClosed(t *testing.T) {
	t.Setenv("LINGTU_BILLING_STRIPE_SECRET_KEY", "")
	t.Setenv("LINGTU_BILLING_STRIPE_WEBHOOK_SECRET", "")
	t.Setenv("LINGTU_BILLING_PLANS", `[{"id":"starter","name":"Starter","currency":"cny","amount":1000,"calls":100,"valid_days":30}]`)
	config := loadBillingConfig()
	if config.Ready || len(config.Plans) != 0 {
		t.Fatalf("unexpected config %+v", config)
	}
	t.Setenv("LINGTU_BILLING_PLANS", `[{"id":"bad","name":"Bad","currency":"cny","amount":1.5,"calls":100,"valid_days":30}]`)
	if len(loadBillingConfig().Plans) != 0 {
		t.Fatal("fractional minor currency accepted")
	}
}

func TestBillingRegisteredRoutesExposeVersionAndDenyAnonymousCustomersAndAdmins(t *testing.T) {
	db := hostDB(t)
	router := gin.New()
	client := router.Group("/api/client", (&Host{}).clientAuth)
	if err := RegisterBilling(router, client, db, "https://account.example"); err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(router)
	defer server.Close()
	for _, path := range []string{"/api/client/billing", "/api/client/billing/orders", "/api/lingtu/admin/billing"} {
		response, err := server.Client().Get(server.URL + path)
		if err != nil {
			t.Fatal(err)
		}
		response.Body.Close()
		if response.StatusCode != 401 {
			t.Fatalf("%s anonymous status %d", path, response.StatusCode)
		}
	}
	response, err := server.Client().Get(server.URL + "/api/lingtu/service")
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	var info struct {
		Version         string   `json:"version"`
		BillingProtocol int      `json:"billing_protocol"`
		Capabilities    []string `json:"capabilities"`
	}
	if response.StatusCode != 200 || json.NewDecoder(response.Body).Decode(&info) != nil || info.Version == "" || info.BillingProtocol != 2 || len(info.Capabilities) == 0 {
		t.Fatalf("missing deployed capability/version: %+v status %d", info, response.StatusCode)
	}
}

func TestBillingCheckoutUsesOfficialSDKWithServerPriceAndStableIdempotency(t *testing.T) {
	db := hostDB(t)
	trials := lingtu.NewTrialStore(db)
	if err := trials.Migrate(); err != nil {
		t.Fatal(err)
	}
	if err := trials.Grant(42, time.Now(), 2, time.Hour); err != nil {
		t.Fatal(err)
	}
	store := lingtu.NewBillingStore(db)
	if err := store.Migrate(); err != nil {
		t.Fatal(err)
	}
	var providerCalls int
	var orderID string
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		providerCalls++
		if r.Method == "POST" {
			if err := r.ParseForm(); err != nil {
				t.Error(err)
			}
			orderID = r.Form.Get("client_reference_id")
			if r.Form.Get("line_items[0][price_data][unit_amount]") != "100" || r.Form.Get("line_items[0][price_data][currency]") != "cny" || r.Form.Get("metadata[lingtu_order]") != orderID || r.Header.Get("Idempotency-Key") != "lingtu-billing-"+orderID {
				t.Error("SDK request price or identity mismatch")
			}
		} else if r.Method != "GET" || r.URL.Path != "/v1/checkout/sessions/cs_sdk" {
			t.Errorf("unexpected retry %s %s", r.Method, r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"cs_sdk","object":"checkout.session","url":"https://checkout.stripe.com/c/pay/fixture"}`))
	}))
	defer provider.Close()
	h := &billingHost{store: store, config: billingConfig{Ready: true, key: "sk_test_fixture", secret: "whsec_fixture", Plans: []lingtu.BillingPlan{{ID: "p", Name: "隔离测试", Currency: "cny", Amount: 100, Calls: 5, ValidDays: 1}}}, portal: "https://account.example", backend: stripe.GetBackendWithConfig(stripe.APIBackend, &stripe.BackendConfig{URL: stripe.String(provider.URL), HTTPClient: provider.Client()})}
	router := gin.New()
	router.Use(func(c *gin.Context) { c.Set("lingtu_identity", lingtu.ClientIdentity{UserID: 42}); c.Next() })
	router.POST("/orders", h.checkout)
	for range 2 {
		req := httptest.NewRequest("POST", "/orders", bytes.NewBufferString(`{"plan_id":"p","request_id":"sdk-test"}`))
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)
		if w.Code != 200 {
			t.Fatalf("checkout status %d %s", w.Code, w.Body.String())
		}
	}
	if providerCalls != 2 || orderID == "" {
		t.Fatal("provider SDK was not invoked")
	}
	orders, err := store.Orders(42, 0, 20)
	if err != nil || len(orders) != 1 || orders[0].State != "pending" {
		t.Fatalf("redirect incorrectly credited: %+v %v", orders, err)
	}
	var grant lingtu.TrialGrant
	db.First(&grant, "user_id = ?", 42)
	if grant.Limit != 2 {
		t.Fatal("checkout changed balance before verified webhook")
	}
}

func TestBillingSignedWebhookCommitsAndRejectsTampering(t *testing.T) {
	db := hostDB(t)
	trials := lingtu.NewTrialStore(db)
	if err := trials.Migrate(); err != nil {
		t.Fatal(err)
	}
	if err := trials.Grant(42, time.Now(), 2, time.Hour); err != nil {
		t.Fatal(err)
	}
	store := lingtu.NewBillingStore(db)
	if err := store.Migrate(); err != nil {
		t.Fatal(err)
	}
	order, err := store.CreateOrder(42, "http-test", lingtu.BillingPlan{ID: "p", Name: "隔离测试", Currency: "cny", Amount: 100, Calls: 5, ValidDays: 1}, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if err = store.AttachCheckout(order.ID, "cs_http"); err != nil {
		t.Fatal(err)
	}
	h := &billingHost{store: store, config: billingConfig{Ready: true, key: "sk_test_fixture", secret: "whsec_fixture"}}
	router := gin.New()
	router.POST("/webhook", h.stripeWebhook)
	payload, _ := json.Marshal(map[string]interface{}{"id": "evt_http", "api_version": stripe.APIVersion, "type": "checkout.session.completed", "livemode": false, "data": map[string]interface{}{"object": map[string]interface{}{"id": "cs_http", "client_reference_id": order.ID, "metadata": map[string]string{"lingtu_order": order.ID}, "mode": "payment", "payment_status": "paid", "amount_total": 100, "currency": "cny"}}})
	signed := webhook.GenerateTestSignedPayload(&webhook.UnsignedPayload{Payload: payload, Secret: "whsec_fixture"})
	send := func(body []byte, signature string) int {
		req := httptest.NewRequest("POST", "/webhook", bytes.NewReader(body))
		req.Header.Set("Stripe-Signature", signature)
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)
		return w.Code
	}
	if code := send(payload, "bad"); code != 400 {
		t.Fatalf("bad signature status %d", code)
	}
	tampered := bytes.Replace(payload, []byte(`"amount_total":100`), []byte(`"amount_total":101`), 1)
	if code := send(tampered, signed.Header); code != 400 {
		t.Fatalf("tampered status %d", code)
	}
	// Disabling the catalog stops new purchases, not settlement of an already
	// paid pending session with valid credentials and provider signature.
	h.config.Ready = false
	for range 2 {
		if code := send(payload, signed.Header); code != 200 {
			t.Fatalf("valid webhook status %d", code)
		}
	}
	var grant lingtu.TrialGrant
	db.First(&grant, "user_id = ?", 42)
	if grant.Limit != 7 {
		t.Fatalf("incorrect grant %+v", grant)
	}
}
func TestBillingOnlyPaidPaymentSessionsCanCredit(t *testing.T) {
	s := stripe.CheckoutSession{ID: "cs_test", ClientReferenceID: "order", Mode: stripe.CheckoutSessionModePayment, PaymentStatus: stripe.CheckoutSessionPaymentStatusPaid, AmountTotal: 1000, Currency: stripe.CurrencyCNY}
	s.Metadata = map[string]string{"lingtu_order": "order"}
	if _, err := billingPayment("evt_1", s); err != nil {
		t.Fatal(err)
	}
	s.PaymentStatus = stripe.CheckoutSessionPaymentStatusUnpaid
	if _, err := billingPayment("evt_1", s); err == nil {
		t.Fatal("unpaid session accepted")
	}
	s.PaymentStatus = stripe.CheckoutSessionPaymentStatusPaid
	s.Mode = stripe.CheckoutSessionModeSubscription
	if _, err := billingPayment("evt_1", s); err == nil {
		t.Fatal("subscription session accepted")
	}
}
