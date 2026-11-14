package lingtuhost

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/lingtu"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/gin-gonic/gin"
	"github.com/stripe/stripe-go/v81"
	"github.com/stripe/stripe-go/v81/checkout/session"
	"github.com/stripe/stripe-go/v81/webhook"
	"gorm.io/gorm"
)

type billingConfig struct {
	Ready       bool                 `json:"ready"`
	Reason      string               `json:"reason"`
	Plans       []lingtu.BillingPlan `json:"plans"`
	Service     billingServiceInfo   `json:"service"`
	key, secret string
}

func loadBillingConfig() billingConfig {
	return billingPublicConfig(billingEnvironmentSettings())
}

// RegisterBilling mounts only explicit customer operations. The caller supplies its
// existing restricted client-auth group; no renderer receives provider credentials.
// Run after TrialStore.Migrate. No background worker or lifecycle cleanup is needed.
func RegisterBilling(router *gin.Engine, authenticated *gin.RouterGroup, db *gorm.DB, portal string) error {
	origin, err := url.Parse(portal)
	if err != nil || origin.Host == "" || origin.User != nil || origin.RawQuery != "" || origin.Fragment != "" || (origin.Path != "" && origin.Path != "/") || (origin.Scheme != "https" && !(origin.Scheme == "http" && origin.Hostname() == "127.0.0.1")) {
		return errors.New("invalid billing portal origin")
	}
	store := lingtu.NewBillingStore(db)
	if err = store.Migrate(); err != nil {
		return err
	}
	h := &billingHost{store: store, db: db, portal: strings.TrimRight(portal, "/")}
	authenticated.GET("/billing", h.catalog)
	authenticated.GET("/billing/orders", h.orders)
	authenticated.POST("/billing/orders", middleware.LingtuCriticalRateLimit("billing-checkout"), h.checkout)
	router.POST("/api/lingtu/billing/stripe/webhook", h.stripeWebhook)
	router.GET("/api/lingtu/service", func(c *gin.Context) { c.Header("Cache-Control", "no-store"); c.JSON(200, billingServiceVersion()) })
	admin := router.Group("/api/lingtu/admin", middleware.DisableCache(), middleware.AdminAuth())
	admin.GET("/billing", h.adminBillingConfig)
	admin.POST("/billing", middleware.LingtuCriticalRateLimit("admin-billing-config"), h.adminSaveBilling)
	admin.POST("/billing/check", middleware.LingtuCriticalRateLimit("admin-billing-check"), h.adminCheckBilling)
	router.GET("/lingtu/billing/payment-return", func(c *gin.Context) {
		c.Header("Content-Type", "text/html; charset=utf-8")
		c.Header("Cache-Control", "no-store")
		c.String(200, `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>支付结果核对</title><body><h1>请返回灵兔 AI 客户端</h1><p>点击“刷新账本”核对订单和额度。返回此页面不代表支付成功，到账以服务端验签账本为准。</p></body></html>`)
	})
	return nil
}

type billingHost struct {
	store   *lingtu.BillingStore
	db      *gorm.DB
	config  billingConfig
	portal  string
	backend stripe.Backend
}

func (h *billingHost) currentConfig() (billingConfig, error) {
	if h.db == nil {
		return h.config, nil
	}
	settings, _, err := loadBillingSettings(h.db)
	if err != nil {
		return billingConfig{}, err
	}
	return billingPublicConfig(settings), nil
}
func (h *billingHost) catalog(c *gin.Context) {
	config, err := h.currentConfig()
	if err != nil {
		clientFailure(c, 503, "billing_unavailable")
		return
	}
	c.JSON(200, config)
}
func (h *billingHost) orders(c *gin.Context) {
	rows, err := h.store.Orders(identityOf(c).UserID, 0, 100)
	if err != nil {
		clientFailure(c, 503, "billing_unavailable")
		return
	}
	c.JSON(200, gin.H{"orders": rows})
}
func (h *billingHost) checkout(c *gin.Context) {
	config, err := h.currentConfig()
	if err != nil {
		clientFailure(c, 503, "billing_unavailable")
		return
	}
	if !config.Ready {
		clientFailure(c, 503, config.Reason)
		return
	}
	var input struct {
		PlanID    string `json:"plan_id"`
		RequestID string `json:"request_id"`
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 4096)
	decoder := json.NewDecoder(c.Request.Body)
	decoder.DisallowUnknownFields()
	if decoder.Decode(&input) != nil {
		clientFailure(c, 400, "invalid_request")
		return
	}
	var trailing interface{}
	if decoder.Decode(&trailing) != io.EOF {
		clientFailure(c, 400, "invalid_request")
		return
	}
	var selected *lingtu.BillingPlan
	for i := range config.Plans {
		if config.Plans[i].ID == input.PlanID {
			selected = &config.Plans[i]
			break
		}
	}
	if selected == nil {
		clientFailure(c, 400, "invalid_plan")
		return
	}
	order, err := h.store.CreateOrder(identityOf(c).UserID, input.RequestID, *selected, time.Now())
	if err != nil {
		status := 503
		code := "billing_unavailable"
		if errors.Is(err, lingtu.ErrBillingConflict) {
			status = 409
			code = "billing_conflict"
		}
		if errors.Is(err, lingtu.ErrBillingInput) {
			status = 400
			code = "invalid_request"
		}
		clientFailure(c, status, code)
		return
	}
	if order.State == "paid" {
		c.JSON(200, gin.H{"order": order, "checkout_url": ""})
		return
	}
	params := &stripe.CheckoutSessionParams{
		Mode: stripe.String("payment"), ClientReferenceID: stripe.String(order.ID),
		SuccessURL: stripe.String(h.portal + "/lingtu/billing/payment-return"), CancelURL: stripe.String(h.portal + "/lingtu/billing/payment-return"),
		Metadata:  map[string]string{"lingtu_order": order.ID},
		LineItems: []*stripe.CheckoutSessionLineItemParams{{Quantity: stripe.Int64(1), PriceData: &stripe.CheckoutSessionLineItemPriceDataParams{Currency: stripe.String(order.Plan.Currency), UnitAmount: stripe.Int64(order.Plan.Amount), ProductData: &stripe.CheckoutSessionLineItemPriceDataProductDataParams{Name: stripe.String(order.Plan.Name)}}}},
	}
	params.Context = c.Request.Context()
	params.SetIdempotencyKey("lingtu-billing-" + order.ID)
	// Per-client key avoids mutating the native wallet's global Stripe key.
	api := session.Client{B: h.stripeBackend(), Key: config.key}
	var checkout *stripe.CheckoutSession
	// Stripe idempotency keys expire. Retrieve a persisted session rather than
	// creating a second payable checkout when the user retries days later.
	if order.SessionID != nil {
		get := &stripe.CheckoutSessionParams{}
		get.Context = c.Request.Context()
		checkout, err = api.Get(*order.SessionID, get)
	} else {
		checkout, err = api.New(params)
	}
	if err != nil || checkout.ID == "" {
		clientFailure(c, 503, "checkout_unavailable")
		return
	}
	target, err := url.Parse(checkout.URL)
	if err != nil || target.Scheme != "https" || target.Host != "checkout.stripe.com" || target.User != nil {
		clientFailure(c, 503, "checkout_unavailable")
		return
	}
	if err = h.store.AttachCheckout(order.ID, checkout.ID); err != nil {
		clientFailure(c, 503, "checkout_unavailable")
		return
	}
	c.JSON(200, gin.H{"order": order, "checkout_url": checkout.URL})
}

func billingPayment(eventID string, s stripe.CheckoutSession) (lingtu.BillingPayment, error) {
	if s.ID == "" || s.ClientReferenceID == "" || s.Metadata["lingtu_order"] != s.ClientReferenceID || s.Mode != stripe.CheckoutSessionModePayment || s.PaymentStatus != stripe.CheckoutSessionPaymentStatusPaid || s.AmountTotal <= 0 {
		return lingtu.BillingPayment{}, lingtu.ErrBillingConflict
	}
	return lingtu.BillingPayment{OrderID: s.ClientReferenceID, SessionID: s.ID, EventID: eventID, Amount: s.AmountTotal, Currency: string(s.Currency)}, nil
}
func (h *billingHost) stripeWebhook(c *gin.Context) {
	config, err := h.currentConfig()
	if err != nil {
		clientFailure(c, 503, "billing_unavailable")
		return
	}
	// Existing paid checkouts still settle after disabling new purchases or plans.
	if config.key == "" || config.secret == "" {
		clientFailure(c, 503, "payment_not_configured")
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 256*1024)
	payload, err := io.ReadAll(c.Request.Body)
	if err != nil {
		clientFailure(c, 400, "invalid_webhook")
		return
	}
	event, err := webhook.ConstructEventWithOptions(payload, c.GetHeader("Stripe-Signature"), config.secret, webhook.ConstructEventOptions{})
	if err != nil {
		clientFailure(c, 400, "invalid_webhook")
		return
	}
	if event.Type != stripe.EventTypeCheckoutSessionCompleted && event.Type != stripe.EventTypeCheckoutSessionAsyncPaymentSucceeded {
		c.Status(200)
		return
	}
	if event.Livemode != strings.HasPrefix(config.key, "sk_live_") {
		clientFailure(c, 400, "payment_mode_mismatch")
		return
	}
	var checkout stripe.CheckoutSession
	if json.Unmarshal(event.Data.Raw, &checkout) != nil {
		clientFailure(c, 400, "invalid_webhook")
		return
	}
	// Delayed payment completion may be unpaid; wait for async_payment_succeeded.
	if checkout.PaymentStatus != stripe.CheckoutSessionPaymentStatusPaid {
		c.Status(200)
		return
	}
	payment, err := billingPayment(event.ID, checkout)
	if err != nil {
		clientFailure(c, 400, "invalid_payment")
		return
	}
	if err = h.store.Credit(payment, time.Now()); err != nil {
		clientFailure(c, 503, "payment_reconciliation_required")
		return
	}
	c.Status(200)
}
