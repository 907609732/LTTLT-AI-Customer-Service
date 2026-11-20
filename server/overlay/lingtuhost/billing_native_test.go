package lingtuhost

import (
	"encoding/json"
	"github.com/QuantumNous/new-api/lingtu"
	"net/http/httptest"
	"testing"
	"time"
)

func TestNativeSupportPlanCheckoutAndCredit(t *testing.T) {
	h, provider, router := fixtureNativeHost(t)
	for range 2 {
		response := fixtureRequest(router, "POST", "/orders", `{"plan_id":"support_100000","request_id":"support","channel":"wechat"}`)
		if response.Code != 200 {
			t.Fatalf("checkout: %d %s", response.Code, response.Body.String())
		}
	}
	orders, err := h.store.Orders(42, 0, 10)
	if err != nil || len(orders) != 1 || provider.creates != 1 {
		t.Fatalf("checkout duplicated: %+v %v", orders, err)
	}
	order := orders[0]
	if order.Plan.Amount != 100000 || order.Plan.Calls != 300000 || order.Plan.ValidDays != 365 || !order.Plan.Permanent {
		t.Fatalf("wrong support tier: %+v", order.Plan)
	}
	provider.result.State = "paid"
	provider.result.Amount = 100000
	for range 2 {
		response := fixtureRequest(router, "GET", "/orders/"+order.ID, "")
		if response.Code != 200 {
			t.Fatalf("credit: %d %s", response.Code, response.Body.String())
		}
	}
	quota, err := h.store.Quota(42, time.Now())
	if err != nil || quota.Permanent.Remaining != 300000 || quota.Paid.Remaining != 0 || quota.Trial.Remaining != 2 {
		t.Fatalf("incorrect support entitlement: %+v %v", quota, err)
	}
}

func TestNativeCatalogDefaultPlansAndChannelIsolation(t *testing.T) {
	t.Setenv("LINGTU_BILLING_PLANS", "")
	t.Setenv("LINGTU_BILLING_ALIPAY_APP_ID", "")
	t.Setenv("LINGTU_BILLING_WECHAT_APP_ID", "")
	c := loadBillingConfig()
	if len(c.Plans) != 3 || c.Plans[0].ID != "usage_1000" || c.Plans[0].Amount != 990 || c.Plans[0].Calls != 1000 || c.Plans[1].Amount != 10000 || c.Plans[1].Calls != 20000 {
		t.Fatalf("default plans missing: %+v", c.Plans)
	}
	if p := c.Plans[2]; p.ID != "support_100000" || p.Amount != 100000 || p.Calls != 300000 || p.ValidDays != 365 || !p.Permanent || !p.Valid() {
		t.Fatalf("support plan incorrect: %+v", p)
	}
	if len(c.Channels) != 2 || c.Channels[0].Ready || c.Channels[1].Ready {
		t.Fatal("unconfigured channels must remain separately unavailable")
	}
}
func TestNativeOrdersKeepPlanSnapshotAcrossCatalogUpdate(t *testing.T) {
	h, provider, router := fixtureNativeHost(t)
	decodeOrder := func(response *httptest.ResponseRecorder) lingtu.BillingOrder {
		t.Helper()
		if response.Code != 200 {
			t.Fatalf("order: %d %s", response.Code, response.Body.String())
		}
		var body struct {
			Order lingtu.BillingOrder `json:"order"`
		}
		if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
			t.Fatal(err)
		}
		return body.Order
	}
	// The catalog now offers 20000 calls, but this pending order keeps the terms it was created with.
	legacy := lingtu.BillingPlan{ID: "usage_10000", Name: "标准包 · 支持一份", Currency: "cny", Amount: 10000, ListAmount: 10000, Calls: 10000, ValidDays: 365}
	old, err := h.store.CreateChannelOrder(42, "legacy-standard", legacy, "wechat", time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if restored := decodeOrder(fixtureRequest(router, "GET", "/orders/"+old.ID, "")); restored.Plan.Calls != 10000 {
		t.Fatalf("restored order adopted new catalog calls: %+v", restored.Plan)
	}
	// Retrying the same request id under the larger offer must report a conflict, not replace the order.
	if conflict := fixtureRequest(router, "POST", "/orders", `{"plan_id":"usage_10000","request_id":"legacy-standard","channel":"wechat"}`); conflict.Code != 409 {
		t.Fatalf("legacy retry replaced snapshot: %d %s", conflict.Code, conflict.Body.String())
	}
	provider.result.State = "paid"
	provider.result.Amount = 10000
	provider.result.TransactionID = "legacy-txn"
	for range 2 {
		decodeOrder(fixtureRequest(router, "GET", "/orders/"+old.ID, ""))
	}
	quota, err := h.store.Quota(42, time.Now())
	if err != nil || quota.Paid.Remaining != 10000 {
		t.Fatalf("legacy order credited %+v %v", quota, err)
	}
	// Orders created after the catalog update take the new offer.
	for range 2 {
		if response := fixtureRequest(router, "POST", "/orders", `{"plan_id":"usage_10000","request_id":"new-standard","channel":"wechat"}`); response.Code != 200 {
			t.Fatalf("new checkout: %d %s", response.Code, response.Body.String())
		}
	}
	orders, err := h.store.Orders(42, 0, 10)
	if err != nil || len(orders) != 2 {
		t.Fatalf("orders %+v %v", orders, err)
	}
	var current lingtu.BillingOrder
	for _, order := range orders {
		if order.RequestID == "new-standard" {
			current = order
		}
	}
	if current.Plan.Calls != 20000 || provider.creates != 2 {
		t.Fatalf("new order calls %+v creates %d", current.Plan, provider.creates)
	}
	provider.result.TransactionID = "new-txn"
	for range 2 {
		decodeOrder(fixtureRequest(router, "GET", "/orders/"+current.ID, ""))
	}
	quota, err = h.store.Quota(42, time.Now())
	if err != nil || quota.Paid.Remaining != 30000 {
		t.Fatalf("new order credited %+v %v", quota, err)
	}
	if kept, err := h.store.Order(42, old.ID); err != nil || kept.Plan.Calls != 10000 || kept.State != "paid" {
		t.Fatalf("legacy snapshot changed: %+v %v", kept.Plan, err)
	}
}

func TestNativePaymentRejectsIdentityAmountAndStateMismatch(t *testing.T) {
	o := lingtu.BillingOrder{ID: "abc", Channel: "wechat", Plan: lingtu.BillingPlan{Currency: "cny", Amount: 990}}
	good := nativeResult{OrderID: "abc", Channel: "wechat", MerchantID: "merchant", AppID: "app", TransactionID: "txn", Amount: 990, Currency: "CNY", State: "paid"}
	if _, err := nativePayment(o, good, "merchant", "app"); err != nil {
		t.Fatal(err)
	}
	for _, mutate := range []func(*nativeResult){func(r *nativeResult) { r.MerchantID = "evil" }, func(r *nativeResult) { r.AppID = "evil" }, func(r *nativeResult) { r.Amount++ }, func(r *nativeResult) { r.Currency = "USD" }, func(r *nativeResult) { r.OrderID = "other" }, func(r *nativeResult) { r.State = "pending" }, func(r *nativeResult) { r.Channel = "alipay" }} {
		r := good
		mutate(&r)
		if _, err := nativePayment(o, r, "merchant", "app"); err == nil {
			t.Fatalf("accepted mismatch %+v", r)
		}
	}
}
func TestNativeMoneyIsExactMinorUnits(t *testing.T) {
	for _, s := range []string{"9.9", "9.90", "10.00", "100"} {
		if _, err := alipayMinor(s); err != nil {
			t.Fatal(s, err)
		}
	}
	for _, s := range []string{"9.901", "NaN", "1e3", "-1", "1.001"} {
		if _, err := alipayMinor(s); err == nil {
			t.Fatal("accepted", s)
		}
	}
}
