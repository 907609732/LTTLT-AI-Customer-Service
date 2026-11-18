package lingtuhost

import "testing"

// Native merchant configuration must coexist with the existing encrypted Stripe
// administration flow; disabling new Stripe purchases cannot disable WeChat.
func TestNativeConfigurationPreservesEncryptedStripeSettings(t *testing.T) {
	db := hostDB(t)
	h := &billingHost{db: db, config: billingConfig{providers: map[string]nativeProvider{"wechat": &wechatNative{app: "app", merchant: "merchant"}}, Channels: []billingChannel{{ID: "wechat", Ready: true}}}}
	input := billingTestInput()
	if err := h.saveBillingSettings(input, 1); err != nil {
		t.Fatal(err)
	}
	current, err := h.currentConfig()
	if err != nil || !current.Ready || current.key != input.SecretKey || len(current.Plans) != 3 || len(current.providers) != 1 {
		t.Fatal("native and Stripe configuration did not coexist", err)
	}
	input.Revision = 1
	input.Enabled = false
	input.SecretKey = ""
	input.WebhookSecret = ""
	if err := h.saveBillingSettings(input, 1); err != nil {
		t.Fatal(err)
	}
	current, err = h.currentConfig()
	if err != nil || !current.Ready || current.key != "sk_test_fixture_private" || current.secret != "whsec_fixture_private" || len(current.providers) != 1 {
		t.Fatal("Stripe disable lost native or historical receipt verification", err)
	}
	if h.stripeReady() {
		t.Fatal("enabled WeChat re-enabled disabled Stripe checkout")
	}
}
