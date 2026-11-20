package lingtuhost

import (
	"context"
	"errors"
	"fmt"
	"github.com/QuantumNous/new-api/lingtu"
	"github.com/gin-gonic/gin"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"
)

type billingChannel struct {
	ID     string `json:"id"`
	Ready  bool   `json:"ready"`
	Reason string `json:"reason"`
}
type nativeResult struct {
	OrderID, Channel, MerchantID, AppID, TransactionID, Currency, State string
	Amount                                                              int64
	PaidAt                                                              int64
}
type nativeProvider interface {
	Create(context.Context, lingtu.BillingOrder) (string, error)
	Query(context.Context, string) (nativeResult, error)
	Close(context.Context, string) error
	Notify(*http.Request) (nativeResult, error)
	Identity() (string, string)
}

func defaultBillingPlans() []lingtu.BillingPlan {
	return []lingtu.BillingPlan{
		{ID: "usage_1000", Name: "体验包 · 小小心意", Currency: "cny", Amount: 990, ListAmount: 1000, Calls: 1000, ValidDays: 365},
		{ID: "usage_10000", Name: "标准包 · 支持一份", Currency: "cny", Amount: 10000, ListAmount: 10000, Calls: 20000, ValidDays: 365},
		{ID: lingtu.PermanentSupportPlanID, Name: "共创支持包", Currency: "cny", Amount: 100000, Calls: 300000, ValidDays: 365, Permanent: true},
	}
}
func (h *billingHost) nativeChannel(channel string) nativeProvider {
	return h.config.providers[channel]
}
func configureNative(c *billingConfig) {
	c.providers = map[string]nativeProvider{}
	for _, channel := range []string{"alipay", "wechat"} {
		p, err := newNativeProvider(channel)
		info := billingChannel{ID: channel, Reason: "payment_not_configured"}
		if err == nil && p != nil {
			c.providers[channel] = p
			info.Ready = true
			info.Reason = ""
			c.Ready = true
		}
		c.Channels = append(c.Channels, info)
	}
	if c.Ready {
		c.Reason = ""
	}
}
func paymentNotifyURL(channel string) (string, error) {
	raw := os.Getenv("LINGTU_BILLING_NOTIFY_ORIGIN")
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" || u.Hostname() == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Path != "" && u.Path != "/") {
		return "", errors.New("invalid notify origin")
	}
	return strings.TrimRight(raw, "/") + "/api/lingtu/billing/" + channel + "/webhook", nil
}
func nativePayment(o lingtu.BillingOrder, r nativeResult, merchant, app string) (lingtu.BillingPayment, error) {
	if r.State != "paid" || r.OrderID != o.ID || r.Channel != o.Channel || r.MerchantID != merchant || r.AppID != app || r.TransactionID == "" || r.Amount != o.Plan.Amount || strings.ToLower(r.Currency) != o.Plan.Currency {
		return lingtu.BillingPayment{}, lingtu.ErrBillingConflict
	}
	return lingtu.BillingPayment{OrderID: o.ID, Channel: r.Channel, MerchantID: r.MerchantID, TransactionID: r.TransactionID, EventID: r.Channel + ":" + r.TransactionID, Amount: r.Amount, Currency: strings.ToLower(r.Currency), PaidAt: r.PaidAt}, nil
}

var decimalMoney = regexp.MustCompile(`^[0-9]{1,9}(\.[0-9]{1,2})?$`)

func alipayMinor(s string) (int64, error) {
	if !decimalMoney.MatchString(s) {
		return 0, lingtu.ErrBillingInput
	}
	parts := strings.Split(s, ".")
	n, _ := strconv.ParseInt(parts[0], 10, 64)
	n *= 100
	if len(parts) == 2 {
		v := parts[1]
		if len(v) == 1 {
			v += "0"
		}
		p, _ := strconv.ParseInt(v, 10, 64)
		n += p
	}
	return n, nil
}
func nativeDTO(o lingtu.BillingOrder) gin.H {
	return gin.H{"order": o, "checkout_url": "", "qr_code": o.QRCode, "expires_at": o.ExpiresAt}
}
func (h *billingHost) nativeCheckout(c *gin.Context, plan lingtu.BillingPlan, request, channel string) {
	p := h.nativeChannel(channel)
	if p == nil {
		clientFailure(c, 503, "payment_not_configured")
		return
	}
	uid := identityOf(c).UserID
	o, err := h.store.CreateChannelOrder(uid, request, plan, channel, time.Now())
	if err != nil {
		h.nativeFailure(c, err)
		return
	}
	if o.State == "reconciling" {
		o, err = h.reconcile(c.Request.Context(), o)
		if err != nil {
			clientFailure(c, 503, "payment_reconciliation_required")
			return
		}
	}
	o, err = h.ensureNativeQR(c.Request.Context(), o)
	if err != nil {
		clientFailure(c, 503, "payment_reconciliation_required")
		return
	}
	c.JSON(200, nativeDTO(o))
}
func (h *billingHost) nativeFailure(c *gin.Context, err error) {
	status, code := 503, "billing_unavailable"
	if errors.Is(err, lingtu.ErrBillingInput) {
		status, code = 400, "invalid_request"
	}
	if errors.Is(err, lingtu.ErrBillingConflict) {
		status, code = 409, "billing_conflict"
	}
	if errors.Is(err, errOrderMissing) {
		status, code = 404, "order_not_found"
	}
	clientFailure(c, status, code)
}

var errOrderMissing = errors.New("order missing")

func (h *billingHost) reconcile(ctx context.Context, o lingtu.BillingOrder) (lingtu.BillingOrder, error) {
	if o.State == "paid" {
		return o, nil
	}
	p := h.nativeChannel(o.Channel)
	if p == nil {
		return o, errors.New("channel unavailable")
	}
	r, err := p.Query(ctx, o.ID)
	if err != nil {
		_, _ = h.store.MarkReconciling(o.UserID, o.ID)
		return o, err
	}
	if r.OrderID != o.ID || r.Channel != o.Channel {
		return o, lingtu.ErrBillingConflict
	}
	merchant, app := p.Identity()
	if r.MerchantID != merchant || r.AppID != app {
		return o, lingtu.ErrBillingConflict
	}
	if r.State == "paid" {
		payment, e := nativePayment(o, r, merchant, app)
		if e != nil {
			return o, e
		}
		if err = h.store.Credit(payment, time.Now()); err != nil {
			return o, err
		}
	}
	if r.State == "closed" {
		return h.store.CloseOrder(o.UserID, o.ID)
	}
	if r.State == "pending" || r.State == "absent" {
		return h.store.MarkPending(o.UserID, o.ID)
	}
	return h.store.Order(o.UserID, o.ID)
}
func (h *billingHost) order(c *gin.Context)      { h.nativeOrderAction(c, false) }
func (h *billingHost) closeOrder(c *gin.Context) { h.nativeOrderAction(c, true) }
func (h *billingHost) nativeOrderAction(c *gin.Context, close bool) {
	uid := identityOf(c).UserID
	o, err := h.store.Order(uid, c.Param("id"))
	if err != nil {
		clientFailure(c, 404, "order_not_found")
		return
	}
	if o.Channel == "stripe" || o.Channel == "" {
		c.JSON(200, nativeDTO(o))
		return
	}
	o, err = h.reconcile(c.Request.Context(), o)
	if err != nil {
		clientFailure(c, 503, "payment_reconciliation_required")
		return
	}
	if !close {
		o, err = h.ensureNativeQR(c.Request.Context(), o)
		if err != nil {
			clientFailure(c, 503, "payment_reconciliation_required")
			return
		}
	}
	if close && o.State != "paid" && o.State != "closed" {
		p := h.nativeChannel(o.Channel)
		if p == nil {
			clientFailure(c, 503, "payment_not_configured")
			return
		}
		// Never mark closed on a timeout: a concurrent paid notification must still credit.
		if err = p.Close(c.Request.Context(), o.ID); err != nil {
			_, _ = h.store.MarkReconciling(uid, o.ID)
			o, e := h.reconcile(c.Request.Context(), o)
			if e == nil && o.State == "paid" {
				c.JSON(200, nativeDTO(o))
				return
			}
			clientFailure(c, 503, "payment_reconciliation_required")
			return
		}
		o, err = h.store.CloseOrder(uid, o.ID)
		if err != nil {
			h.nativeFailure(c, err)
			return
		}
	}
	c.JSON(200, nativeDTO(o))
}
func (h *billingHost) nativeWebhook(channel string) gin.HandlerFunc {
	return func(c *gin.Context) {
		p := h.nativeChannel(channel)
		if p == nil {
			clientFailure(c, 503, "payment_not_configured")
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 256*1024)
		r, err := p.Notify(c.Request)
		if err != nil {
			clientFailure(c, 400, "invalid_webhook")
			return
		}
		if r.State != "paid" {
			clientFailure(c, 400, "invalid_payment")
			return
		}
		// Provider-authenticated order identity, then immutable merchant/price checks inside Credit.
		o, err := h.store.LookupOrder(r.OrderID)
		if err != nil {
			clientFailure(c, 400, "invalid_payment")
			return
		}
		merchant, app := p.Identity()
		payment, err := nativePayment(o, r, merchant, app)
		if err != nil {
			clientFailure(c, 400, "invalid_payment")
			return
		}
		if err = h.store.Credit(payment, time.Now()); err != nil {
			clientFailure(c, 503, "payment_reconciliation_required")
			return
		}
		if channel == "alipay" {
			c.String(200, "success")
		} else {
			c.Status(204)
		}
	}
}
func moneyString(n int64) string { return fmt.Sprintf("%d.%02d", n/100, n%100) }

// Both retry POST and status polling recover a lost creation response using the
// same immutable merchant order number. No new local/provider payment is created.
func (h *billingHost) ensureNativeQR(ctx context.Context, o lingtu.BillingOrder) (lingtu.BillingOrder, error) {
	if (o.State != "pending" && o.State != "reconciling") || o.QRCode != "" {
		return o, nil
	}
	p := h.nativeChannel(o.Channel)
	if p == nil {
		return o, errors.New("channel unavailable")
	}
	qr, err := p.Create(ctx, o)
	if err != nil {
		_, _ = h.store.MarkReconciling(o.UserID, o.ID)
		return o, err
	}
	if qr == "" || len(qr) > 4096 {
		return o, errors.New("invalid QR payload")
	}
	if err = h.store.AttachNativeCheckout(o.ID, qr, time.Unix(o.CreatedAt, 0).Add(15*time.Minute).Unix()); err != nil {
		return o, err
	}
	return h.store.Order(o.UserID, o.ID)
}
