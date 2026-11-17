package lingtuhost

import (
	"github.com/QuantumNous/new-api/lingtu"
	"testing"
)

func TestNativeCatalogDefaultPlansAndChannelIsolation(t *testing.T) {
	t.Setenv("LINGTU_BILLING_PLANS", "")
	t.Setenv("LINGTU_BILLING_ALIPAY_APP_ID", "")
	t.Setenv("LINGTU_BILLING_WECHAT_APP_ID", "")
	c := loadBillingConfig()
	if len(c.Plans) != 2 || c.Plans[0].ID != "usage_1000" || c.Plans[0].Amount != 990 || c.Plans[1].Amount != 10000 {
		t.Fatalf("default plans missing: %+v", c.Plans)
	}
	if len(c.Channels) != 2 || c.Channels[0].Ready || c.Channels[1].Ready {
		t.Fatal("unconfigured channels must remain separately unavailable")
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
