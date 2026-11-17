package lingtuhost

import (
	"bytes"
	"context"
	"errors"
	"github.com/QuantumNous/new-api/lingtu"
	"github.com/gin-gonic/gin"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

type fixtureNative struct {
	result                   nativeResult
	creates, queries, closes int
	queryErr, closeErr       error
	paidOnClose              bool
}

func (p *fixtureNative) Identity() (string, string) { return "merchant", "app" }
func (p *fixtureNative) Create(_ context.Context, o lingtu.BillingOrder) (string, error) {
	p.creates++
	p.result.OrderID = o.ID
	return "weixin://wxpay/bizpayurl?pr=fixture", nil
}
func (p *fixtureNative) Query(_ context.Context, id string) (nativeResult, error) {
	p.queries++
	r := p.result
	r.OrderID = id
	return r, p.queryErr
}
func (p *fixtureNative) Close(_ context.Context, _ string) error {
	p.closes++
	if p.paidOnClose {
		p.result.State = "paid"
	}
	return p.closeErr
}
func (p *fixtureNative) Notify(_ *http.Request) (nativeResult, error) { return p.result, nil }
func fixtureNativeHost(t *testing.T) (*billingHost, *fixtureNative, *gin.Engine) {
	t.Helper()
	db := hostDB(t)
	tr := lingtu.NewTrialStore(db)
	if e := tr.Migrate(); e != nil {
		t.Fatal(e)
	}
	if e := tr.Grant(42, time.Now(), 2, time.Hour); e != nil {
		t.Fatal(e)
	}
	store := lingtu.NewBillingStore(db)
	if e := store.Migrate(); e != nil {
		t.Fatal(e)
	}
	p := &fixtureNative{result: nativeResult{Channel: "wechat", MerchantID: "merchant", AppID: "app", TransactionID: "query-txn", State: "pending", Amount: 990, Currency: "CNY", PaidAt: time.Now().Unix()}}
	h := &billingHost{store: store, config: billingConfig{Ready: true, Plans: defaultBillingPlans(), providers: map[string]nativeProvider{"wechat": p}}}
	r := gin.New()
	r.Use(func(c *gin.Context) { c.Set("lingtu_identity", lingtu.ClientIdentity{UserID: 42}); c.Next() })
	r.POST("/orders", h.checkout)
	r.GET("/orders/:id", h.order)
	r.POST("/orders/:id/close", h.closeOrder)
	return h, p, r
}
func fixtureRequest(r *gin.Engine, method, path, body string) *httptest.ResponseRecorder {
	w := httptest.NewRecorder()
	req := httptest.NewRequest(method, path, bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)
	return w
}
func TestNativeCheckoutRetryQueryCreditAndAccountIsolation(t *testing.T) {
	h, p, r := fixtureNativeHost(t)
	for range 2 {
		w := fixtureRequest(r, "POST", "/orders", `{"plan_id":"usage_1000","request_id":"retry","channel":"wechat"}`)
		if w.Code != 200 {
			t.Fatalf("%d %s", w.Code, w.Body.String())
		}
	}
	if p.creates != 1 {
		t.Fatal("retry created duplicate checkout")
	}
	rows, _ := h.store.Orders(42, 0, 10)
	o := rows[0]
	if _, e := h.store.Order(43, o.ID); e == nil {
		t.Fatal("cross account lookup accepted")
	}
	p.result.State = "paid"
	for range 2 {
		w := fixtureRequest(r, "GET", "/orders/"+o.ID, "")
		if w.Code != 200 {
			t.Fatal(w.Code, w.Body.String())
		}
	}
	q, e := h.store.Quota(42, time.Now())
	if e != nil || q.Paid.Remaining != 1000 {
		t.Fatalf("query reconciliation %+v %v", q, e)
	}
	w := fixtureRequest(r, "POST", "/orders", `{"plan_id":"usage_1000","request_id":"retry","channel":"alipay"}`)
	if w.Code == 200 {
		t.Fatal("channel changed")
	}
}
func TestNativeCloseRaceAndTimeoutPreserveFunds(t *testing.T) {
	for _, paid := range []bool{false, true} {
		t.Run(map[bool]string{false: "timeout", true: "paid-race"}[paid], func(t *testing.T) {
			h, p, r := fixtureNativeHost(t)
			o, e := h.store.CreateChannelOrder(42, "close", defaultBillingPlans()[0], "wechat", time.Now())
			if e != nil {
				t.Fatal(e)
			}
			p.closeErr = errors.New("provider timeout")
			p.paidOnClose = paid
			w := fixtureRequest(r, "POST", "/orders/"+o.ID+"/close", "")
			updated, _ := h.store.Order(42, o.ID)
			if paid {
				if w.Code != 200 || updated.State != "paid" {
					t.Fatalf("lost paid race %d %+v", w.Code, updated)
				}
			} else {
				if w.Code != 503 || updated.State == "closed" {
					t.Fatalf("uncertain close marked closed %d %+v", w.Code, updated)
				}
			}
		})
	}
}
func TestNativeQueryMismatchCannotCreditAndRetriesRecover(t *testing.T) {
	h, p, r := fixtureNativeHost(t)
	o, _ := h.store.CreateChannelOrder(42, "query-retry", defaultBillingPlans()[0], "wechat", time.Now())
	p.queryErr = errors.New("timeout")
	if w := fixtureRequest(r, "GET", "/orders/"+o.ID, ""); w.Code != 503 {
		t.Fatal(w.Code)
	}
	p.queryErr = nil
	p.result.State = "paid"
	p.result.Amount++
	if w := fixtureRequest(r, "GET", "/orders/"+o.ID, ""); w.Code != 503 {
		t.Fatal("wrong amount credited")
	}
	p.result.Amount--
	if w := fixtureRequest(r, "GET", "/orders/"+o.ID, ""); w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	q, _ := h.store.Quota(42, time.Now())
	if q.Paid.Remaining != 1000 {
		t.Fatal(q)
	}
}
func TestNativePendingRecoveryRestoresQRAndClosedPaymentReconciles(t *testing.T) {
	h, p, r := fixtureNativeHost(t)
	o, _ := h.store.CreateChannelOrder(42, "recover", defaultBillingPlans()[0], "wechat", time.Now())
	_, _ = h.store.MarkReconciling(42, o.ID)
	w := fixtureRequest(r, "GET", "/orders/"+o.ID, "")
	updated, _ := h.store.Order(42, o.ID)
	if w.Code != 200 || updated.QRCode == "" || p.creates != 1 {
		t.Fatalf("QR retry stuck status=%d order=%+v creates=%d", w.Code, updated, p.creates)
	}
	_, _ = h.store.CloseOrder(42, o.ID)
	p.result.State = "paid"
	w = fixtureRequest(r, "GET", "/orders/"+o.ID, "")
	updated, _ = h.store.Order(42, o.ID)
	if w.Code != 200 || updated.State != "paid" {
		t.Fatal("closed late payment not reconciled", w.Code, updated.State)
	}
}
func TestNativeCreationTimeoutRecoveryUsesSameOrderNumber(t *testing.T) {
	h, p, r := fixtureNativeHost(t)
	o, _ := h.store.CreateChannelOrder(42, "creation-timeout", defaultBillingPlans()[0], "wechat", time.Now())
	_, _ = h.store.MarkReconciling(42, o.ID)
	p.result.State = "absent"
	w := fixtureRequest(r, "GET", "/orders/"+o.ID, "")
	updated, _ := h.store.Order(42, o.ID)
	if w.Code != 200 || updated.QRCode == "" || p.creates != 1 || p.result.OrderID != o.ID {
		t.Fatalf("cannot recover same merchant number %d %+v", w.Code, updated)
	}
}
