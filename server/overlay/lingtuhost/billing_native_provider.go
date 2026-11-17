package lingtuhost

import (
	"bytes"
	"context"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"errors"
	"github.com/QuantumNous/new-api/lingtu"
	"github.com/go-pay/crypto/xpem"
	"github.com/go-pay/gopay"
	"github.com/go-pay/gopay/alipay"
	"github.com/go-pay/gopay/pkg/xhttp"
	wechat "github.com/go-pay/gopay/wechat/v3"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

type alipayNative struct {
	client                *alipay.Client
	app, merchant, public string
}
type wechatNative struct {
	client                            *wechat.ClientV3
	app, merchant, key, keyID, notify string
	public                            *rsa.PublicKey
}

func newNativeProvider(channel string) (nativeProvider, error) {
	notify, err := paymentNotifyURL(channel)
	if err != nil {
		return nil, err
	}
	get := func(k string) string {
		return strings.TrimSpace(os.Getenv("LINGTU_BILLING_" + strings.ToUpper(channel) + "_" + k))
	}
	app, merchant, private, public := get("APP_ID"), get("MERCHANT_ID"), get("PRIVATE_KEY"), get("PUBLIC_KEY")
	if app == "" || merchant == "" || private == "" || public == "" {
		return nil, errors.New("missing merchant config")
	}
	pub, err := xpem.DecodePublicKey([]byte(public))
	if err != nil || pub == nil {
		return nil, errors.New("invalid provider public key")
	}
	if channel == "alipay" {
		if block, _ := pem.Decode([]byte(private)); block != nil {
			private = base64.StdEncoding.EncodeToString(block.Bytes)
		}
		c, e := alipay.NewClient(app, private, true)
		if e != nil {
			return nil, e
		}
		c.AutoVerifySign([]byte(public))
		c.SetHttpClient(xhttp.NewClient().SetTransport(alipayVerifiedTransport{base: http.DefaultTransport.(*http.Transport).Clone(), public: public}))
		c.SetNotifyUrl(notify)
		return &alipayNative{client: c, app: app, merchant: merchant, public: public}, nil
	}
	key, serial, keyID := get("API_V3_KEY"), get("CERT_SERIAL"), get("PUBLIC_KEY_ID")
	if len(key) != 32 || serial == "" || keyID == "" {
		return nil, errors.New("missing wechat config")
	}
	c, e := wechat.NewClientV3(merchant, serial, key, private)
	if e != nil {
		return nil, e
	}
	if e = c.AutoVerifySignByPublicKey([]byte(public), keyID); e != nil {
		return nil, e
	}
	return &wechatNative{client: c, app: app, merchant: merchant, key: key, keyID: keyID, notify: notify, public: pub}, nil
}
func (p *alipayNative) Identity() (string, string) { return p.merchant, p.app }
func (p *alipayNative) Create(ctx context.Context, o lingtu.BillingOrder) (string, error) {
	r, e := p.client.TradePrecreate(ctx, gopay.BodyMap{"out_trade_no": o.ID, "total_amount": moneyString(o.Plan.Amount), "subject": o.Plan.Name, "timeout_express": "15m", "seller_id": p.merchant})
	if e != nil {
		return "", e
	}
	if r == nil || r.Response == nil || r.Response.Code != "10000" || r.Response.OutTradeNo != o.ID {
		return "", errors.New("precreate rejected")
	}
	return r.Response.QrCode, nil
}
func (p *alipayNative) Query(ctx context.Context, id string) (nativeResult, error) {
	r, e := p.client.TradeQuery(ctx, gopay.BodyMap{"out_trade_no": id})
	if r != nil && r.Response != nil && r.Response.SubCode == "ACQ.TRADE_NOT_EXIST" {
		return nativeResult{Channel: "alipay", AppID: p.app, MerchantID: p.merchant, OrderID: id, State: "absent"}, nil
	}
	if e != nil {
		return nativeResult{}, e
	}
	if r == nil || r.Response == nil || r.Response.Code != "10000" {
		return nativeResult{}, errors.New("query rejected")
	}
	v := r.Response
	amount, e := alipayMinor(v.TotalAmount)
	if e != nil {
		return nativeResult{}, e
	}
	state := "pending"
	if v.TradeStatus == "TRADE_SUCCESS" || v.TradeStatus == "TRADE_FINISHED" {
		state = "paid"
	}
	if v.TradeStatus == "TRADE_CLOSED" {
		state = "closed"
	}
	// Signed query is scoped by the configured merchant app; seller identity is explicit in notification.
	paid, _ := time.ParseInLocation("2006-01-02 15:04:05", v.SendPayDate, time.FixedZone("CST", 8*3600))
	return nativeResult{PaidAt: paid.Unix(), Channel: "alipay", AppID: p.app, MerchantID: p.merchant, OrderID: v.OutTradeNo, TransactionID: v.TradeNo, Amount: amount, Currency: alipayCurrency(v.TransCurrency), State: state}, nil
}
func (p *alipayNative) Close(ctx context.Context, id string) error {
	r, e := p.client.TradeClose(ctx, gopay.BodyMap{"out_trade_no": id})
	if r != nil && r.Response != nil && r.Response.SubCode == "ACQ.TRADE_NOT_EXIST" {
		return nil
	}
	if e != nil {
		return e
	}
	if r == nil || r.Response == nil || r.Response.Code != "10000" || r.Response.OutTradeNo != id {
		return errors.New("close rejected")
	}
	return nil
}
func (p *alipayNative) Notify(req *http.Request) (nativeResult, error) {
	// Query parameters must never override signed POST form values; duplicate form fields fail closed.
	if req.Method != "POST" || req.URL.RawQuery != "" {
		return nativeResult{}, errors.New("invalid notify method")
	}
	if err := req.ParseForm(); err != nil {
		return nativeResult{}, err
	}
	for _, v := range req.PostForm {
		if len(v) != 1 {
			return nativeResult{}, errors.New("duplicate notify field")
		}
	}
	bm, e := alipay.ParseNotifyByURLValues(req.PostForm)
	if e != nil {
		return nativeResult{}, e
	}
	if bm.GetString("sign_type") != "RSA2" {
		return nativeResult{}, errors.New("invalid signature type")
	}
	ok, e := alipay.VerifySign(alipayPublicBody(p.public), bm)
	if e != nil || !ok {
		return nativeResult{}, errors.New("invalid signature")
	}
	amount, e := alipayMinor(bm.GetString("total_amount"))
	if e != nil {
		return nativeResult{}, e
	}
	state := "pending"
	if v := bm.GetString("trade_status"); v == "TRADE_SUCCESS" || v == "TRADE_FINISHED" {
		state = "paid"
	}
	paid, _ := time.ParseInLocation("2006-01-02 15:04:05", bm.GetString("gmt_payment"), time.FixedZone("CST", 8*3600))
	return nativeResult{Channel: "alipay", OrderID: bm.GetString("out_trade_no"), MerchantID: bm.GetString("seller_id"), AppID: bm.GetString("app_id"), TransactionID: bm.GetString("trade_no"), Amount: amount, Currency: alipayCurrency(bm.GetString("trans_currency")), State: state, PaidAt: paid.Unix()}, nil
}
func (p *wechatNative) Identity() (string, string) { return p.merchant, p.app }
func (p *wechatNative) Create(ctx context.Context, o lingtu.BillingOrder) (string, error) {
	r, e := p.client.V3TransactionNative(ctx, gopay.BodyMap{"appid": p.app, "mchid": p.merchant, "description": o.Plan.Name, "out_trade_no": o.ID, "notify_url": p.notify, "time_expire": time.Unix(o.CreatedAt, 0).Add(15 * time.Minute).Format(time.RFC3339), "amount": gopay.BodyMap{"total": o.Plan.Amount, "currency": "CNY"}})
	if e != nil {
		return "", e
	}
	if r == nil || r.Code != wechat.Success || r.Response == nil {
		return "", errors.New("native checkout rejected")
	}
	return r.Response.CodeUrl, nil
}
func (p *wechatNative) Query(ctx context.Context, id string) (nativeResult, error) {
	r, e := p.client.V3TransactionQueryOrder(ctx, wechat.OutTradeNo, id)
	if e == nil && r != nil && r.ErrResponse.Code == "ORDER_NOT_EXIST" && p.verifyResponse(r.SignInfo) == nil {
		return nativeResult{Channel: "wechat", AppID: p.app, MerchantID: p.merchant, OrderID: id, State: "absent"}, nil
	}
	if e != nil {
		return nativeResult{}, e
	}
	if r == nil || r.Code != wechat.Success || r.Response == nil {
		return nativeResult{}, errors.New("query rejected")
	}
	v := r.Response
	return wechatResult(v.Appid, v.Mchid, v.OutTradeNo, v.TransactionId, v.TradeState, v.SuccessTime, v.Amount), nil
}
func wechatResult(app, merchant, order, transaction, state, paid string, amount *wechat.Amount) nativeResult {
	r := nativeResult{Channel: "wechat", AppID: app, MerchantID: merchant, OrderID: order, TransactionID: transaction, State: "pending"}
	if amount != nil {
		r.Amount = int64(amount.Total)
		r.Currency = amount.Currency
	}
	if state == "SUCCESS" {
		r.State = "paid"
	}
	if state == "CLOSED" {
		r.State = "closed"
	}
	if t, e := time.Parse(time.RFC3339, paid); e == nil {
		r.PaidAt = t.Unix()
	}
	return r
}
func (p *wechatNative) Close(ctx context.Context, id string) error {
	r, e := p.client.V3TransactionCloseOrder(ctx, id)
	if e == nil && r != nil && r.ErrResponse.Code == "ORDER_NOT_EXIST" && p.verifyResponse(r.SignInfo) == nil {
		return nil
	}
	if e != nil {
		return e
	}
	if r == nil || r.Code != wechat.Success {
		return errors.New("close rejected")
	}
	return nil
}
func (p *wechatNative) Notify(req *http.Request) (nativeResult, error) {
	n, e := wechat.V3ParseNotify(req)
	if e != nil {
		return nativeResult{}, e
	}
	if n.SignInfo == nil || n.SignInfo.HeaderSerial != p.keyID || n.Resource == nil || n.Resource.Algorithm != "AEAD_AES_256_GCM" || n.EventType != "TRANSACTION.SUCCESS" {
		return nativeResult{}, errors.New("invalid notification")
	}
	if e = n.VerifySignByPK(p.public); e != nil {
		return nativeResult{}, e
	}
	v, e := n.DecryptPayCipherText(p.key)
	if e != nil {
		return nativeResult{}, e
	}
	return wechatResult(v.Appid, v.Mchid, v.OutTradeNo, v.TransactionId, v.TradeState, v.SuccessTime, v.Amount), nil
}

func alipayCurrency(v string) string {
	if v == "" {
		return "CNY"
	}
	return v
}

// GoPay returns Alipay business errors before its optional signature check. Verify
// the complete raw response first, so a not-found result can safely guide retry.
type alipayVerifiedTransport struct {
	base   http.RoundTripper
	public string
}

func (t alipayVerifiedTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	r, err := t.base.RoundTrip(req)
	if err != nil {
		return nil, err
	}
	raw, err := io.ReadAll(io.LimitReader(r.Body, 256*1024+1))
	r.Body.Close()
	if err != nil || len(raw) > 256*1024 {
		return nil, errors.New("invalid alipay response")
	}
	var envelope map[string]json.RawMessage
	if json.Unmarshal(raw, &envelope) != nil {
		return nil, errors.New("invalid alipay response")
	}
	var sign string
	if json.Unmarshal(envelope["sign"], &sign) != nil {
		return nil, errors.New("unsigned alipay response")
	}
	var payload []byte
	for k, v := range envelope {
		if strings.HasSuffix(k, "_response") {
			if payload != nil {
				return nil, errors.New("ambiguous alipay response")
			}
			payload = v
		}
	}
	if len(payload) == 0 {
		return nil, errors.New("missing alipay response")
	}
	if ok, e := alipay.VerifySyncSign(alipayPublicBody(t.public), string(payload), sign); e != nil || !ok {
		return nil, errors.New("invalid alipay signature")
	}
	r.Body = io.NopCloser(bytes.NewReader(raw))
	return r, nil
}
func (p *wechatNative) verifyResponse(si *wechat.SignInfo) error {
	if si == nil || si.HeaderSerial != p.keyID || p.public == nil {
		return errors.New("untrusted wechat response")
	}
	return wechat.V3VerifySignByPK(si.HeaderTimestamp, si.HeaderNonce, si.SignBody, si.HeaderSignature, p.public)
}

func alipayPublicBody(s string) string {
	return strings.Join(strings.Fields(strings.ReplaceAll(strings.ReplaceAll(s, "-----BEGIN PUBLIC KEY-----", ""), "-----END PUBLIC KEY-----", "")), "")
}
