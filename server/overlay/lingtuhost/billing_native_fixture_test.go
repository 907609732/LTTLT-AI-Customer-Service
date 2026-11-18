package lingtuhost

import (
	"bytes"
	"context"
	"crypto"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"github.com/QuantumNous/new-api/lingtu"
	"github.com/gin-gonic/gin"
	"github.com/go-pay/gopay"
	"github.com/go-pay/gopay/alipay"
	"github.com/go-pay/gopay/pkg/xhttp"
	wechat "github.com/go-pay/gopay/wechat/v3"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"testing"
	"time"
)

func fixtureKey(t *testing.T) (*rsa.PrivateKey, string) {
	t.Helper()
	k, e := rsa.GenerateKey(rand.Reader, 2048)
	if e != nil {
		t.Fatal(e)
	}
	b, e := x509.MarshalPKIXPublicKey(&k.PublicKey)
	if e != nil {
		t.Fatal(e)
	}
	return k, string(pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: b}))
}
func fixtureSign(t *testing.T, k *rsa.PrivateKey, s string) string {
	t.Helper()
	h := sha256.Sum256([]byte(s))
	b, e := rsa.SignPKCS1v15(rand.Reader, k, crypto.SHA256, h[:])
	if e != nil {
		t.Fatal(e)
	}
	return base64.StdEncoding.EncodeToString(b)
}
func TestNativeGoPayAlipaySignedFixtureAndTamper(t *testing.T) {
	key, pub := fixtureKey(t)
	p := &alipayNative{app: "app", merchant: "merchant", public: pub}
	bm := gopay.BodyMap{"app_id": "app", "seller_id": "merchant", "out_trade_no": "order", "trade_no": "trade", "trade_status": "TRADE_SUCCESS", "total_amount": "9.90", "gmt_payment": "2026-11-15 10:00:00"}
	signature := fixtureSign(t, key, bm.EncodeAliPaySignParams())
	v := url.Values{}
	for k, x := range bm {
		v.Set(k, fmt.Sprint(x))
	}
	v.Set("sign_type", "RSA2")
	v.Set("sign", signature)
	call := func() error {
		req := httptest.NewRequest("POST", "/notify", bytes.NewBufferString(v.Encode()))
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		r, e := p.Notify(req)
		if e == nil && (r.Amount != 990 || r.MerchantID != "merchant" || r.PaidAt <= 0) {
			t.Fatal(r)
		}
		return e
	}
	if e := call(); e != nil {
		t.Fatal(e)
	}
	v.Set("total_amount", "10.00")
	if call() == nil {
		t.Fatal("tampered amount accepted")
	}
	v.Set("total_amount", "9.90")
	v.Add("seller_id", "evil")
	if call() == nil {
		t.Fatal("duplicate seller accepted")
	}
}
func TestNativeGoPayWechatSignedEncryptedFixture(t *testing.T) {
	key, _ := fixtureKey(t)
	p := &wechatNative{app: "app", merchant: "merchant", key: "01234567890123456789012345678901", keyID: "PUB_KEY_ID_fixture", public: &key.PublicKey}
	plain := []byte(`{"appid":"app","mchid":"merchant","out_trade_no":"order","transaction_id":"trade","trade_state":"SUCCESS","success_time":"2026-11-15T10:00:00+08:00","amount":{"total":990,"currency":"CNY"}}`)
	block, _ := aes.NewCipher([]byte(p.key))
	gcm, _ := cipher.NewGCM(block)
	nonce := "123456789012"
	additional := "transaction"
	encrypted := base64.StdEncoding.EncodeToString(gcm.Seal(nil, []byte(nonce), plain, []byte(additional)))
	body, _ := json.Marshal(map[string]interface{}{"id": "event", "event_type": "TRANSACTION.SUCCESS", "resource_type": "encrypt-resource", "resource": map[string]string{"algorithm": "AEAD_AES_256_GCM", "nonce": nonce, "associated_data": additional, "ciphertext": encrypted}})
	timestamp := strconv.FormatInt(time.Now().Unix(), 10)
	sig := fixtureSign(t, key, timestamp+"\nnonce\n"+string(body)+"\n")
	call := func(payload []byte, serial string) error {
		req := httptest.NewRequest("POST", "/notify", bytes.NewReader(payload))
		req.Header.Set("Wechatpay-Timestamp", timestamp)
		req.Header.Set("Wechatpay-Nonce", "nonce")
		req.Header.Set("Wechatpay-Signature", sig)
		req.Header.Set("Wechatpay-Serial", serial)
		r, e := p.Notify(req)
		if e == nil && (r.Amount != 990 || r.TransactionID != "trade" || r.PaidAt <= 0) {
			t.Fatal(r)
		}
		return e
	}
	if e := call(body, p.keyID); e != nil {
		t.Fatal(e)
	}
	if call(body, "evil") == nil {
		t.Fatal("unknown platform key accepted")
	}
	if call(append(body, ' '), p.keyID) == nil {
		t.Fatal("tampered payload accepted")
	}
	p.key = "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
	if call(body, p.keyID) == nil {
		t.Fatal("bad decryption key accepted")
	}
}
func TestNativeWebhookDuplicateCreditsOnceAndRejectsMerchantMismatch(t *testing.T) {
	db := hostDB(t)
	trials := lingtu.NewTrialStore(db)
	if e := trials.Migrate(); e != nil {
		t.Fatal(e)
	}
	if e := trials.Grant(42, time.Now(), 2, time.Hour); e != nil {
		t.Fatal(e)
	}
	store := lingtu.NewBillingStore(db)
	if e := store.Migrate(); e != nil {
		t.Fatal(e)
	}
	plan := defaultBillingPlans()[0]
	o, e := store.CreateChannelOrder(42, "native-webhook", plan, "alipay", time.Now())
	if e != nil {
		t.Fatal(e)
	}
	key, pub := fixtureKey(t)
	p := &alipayNative{app: "app", merchant: "merchant", public: pub}
	h := &billingHost{store: store, config: billingConfig{providers: map[string]nativeProvider{"alipay": p}}}
	router := gin.New()
	router.POST("/notify", h.nativeWebhook("alipay"))
	post := func(merchant string) int {
		bm := gopay.BodyMap{"app_id": "app", "seller_id": merchant, "out_trade_no": o.ID, "trade_no": "trade-credit", "trade_status": "TRADE_SUCCESS", "total_amount": "9.90", "gmt_payment": "2026-11-15 10:00:00"}
		sig := fixtureSign(t, key, bm.EncodeAliPaySignParams())
		v := url.Values{}
		for k, x := range bm {
			v.Set(k, fmt.Sprint(x))
		}
		v.Set("sign_type", "RSA2")
		v.Set("sign", sig)
		req := httptest.NewRequest("POST", "/notify", bytes.NewBufferString(v.Encode()))
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)
		return w.Code
	}
	if post("evil") != 400 {
		t.Fatal("wrong merchant accepted")
	}
	for range 2 {
		if c := post("merchant"); c != 200 {
			t.Fatalf("notify status %d", c)
		}
	}
	q, e := store.Quota(42, time.Now())
	if e != nil {
		t.Fatal(e)
	}
	if q.Paid.Remaining != 1000 || q.Trial.Remaining != 2 {
		t.Fatalf("repeated credit %+v", q)
	}
}

type fixtureRoundTripper func(*http.Request) (*http.Response, error)

func (f fixtureRoundTripper) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func TestNativeGoPayWechatSDKCreateQueryCloseSignedResponses(t *testing.T) {
	key, pub := fixtureKey(t)
	pri := string(pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(key)}))
	client, e := wechat.NewClientV3("merchant", "serial", "01234567890123456789012345678901", pri)
	if e != nil {
		t.Fatal(e)
	}
	if e = client.AutoVerifySignByPublicKey([]byte(pub), "PUB_KEY_ID_fixture"); e != nil {
		t.Fatal(e)
	}
	calls := 0
	client.SetHttpClient(xhttp.NewClient().SetTransport(fixtureRoundTripper(func(req *http.Request) (*http.Response, error) {
		calls++
		if req.URL.Host != "api.mch.weixin.qq.com" || !strings.HasPrefix(req.Header.Get("Authorization"), "WECHATPAY2-SHA256-RSA2048 ") {
			t.Error("incorrect official request", req.URL, req.Header.Get("Authorization"))
		}
		status, body := 200, `{"code_url":"weixin://fixture"}`
		if req.Method == "GET" {
			body = `{"appid":"app","mchid":"merchant","out_trade_no":"order","transaction_id":"trade","trade_state":"SUCCESS","success_time":"2026-11-15T10:00:00+08:00","amount":{"total":990,"currency":"CNY"}}`
		} else if strings.HasSuffix(req.URL.Path, "/close") {
			status, body = 204, ""
		} else {
			b, _ := io.ReadAll(req.Body)
			if !bytes.Contains(b, []byte(`"total":990`)) || !bytes.Contains(b, []byte(`"out_trade_no":"order"`)) {
				t.Error("wrong server price", string(b))
			}
		}
		ts := strconv.FormatInt(time.Now().Unix(), 10)
		h := http.Header{}
		h.Set("Wechatpay-Timestamp", ts)
		h.Set("Wechatpay-Nonce", "nonce")
		h.Set("Wechatpay-Serial", "PUB_KEY_ID_fixture")
		h.Set("Wechatpay-Signature", fixtureSign(t, key, ts+"\nnonce\n"+body+"\n"))
		return &http.Response{StatusCode: status, Header: h, Body: io.NopCloser(strings.NewReader(body))}, nil
	})))
	p := &wechatNative{client: client, app: "app", merchant: "merchant", notify: "https://merchant.example/notify"}
	o := lingtu.BillingOrder{ID: "order", Plan: defaultBillingPlans()[0]}
	qr, e := p.Create(context.Background(), o)
	if e != nil || qr != "weixin://fixture" {
		t.Fatal("create", qr, e)
	}
	r, e := p.Query(context.Background(), o.ID)
	if e != nil || r.State != "paid" || r.Amount != 990 {
		t.Fatal("query", r, e)
	}
	if e = p.Close(context.Background(), o.ID); e != nil {
		t.Fatal("close", e)
	}
	if calls != 3 {
		t.Fatal(calls)
	}
}
func TestNativeMerchantPEMConfigurationInitializesOnlyConfiguredChannel(t *testing.T) {
	key, pub := fixtureKey(t)
	t.Setenv("LINGTU_BILLING_PLANS", "")
	t.Setenv("LINGTU_BILLING_NOTIFY_ORIGIN", "https://merchant.example")
	t.Setenv("LINGTU_BILLING_ALIPAY_APP_ID", "app")
	t.Setenv("LINGTU_BILLING_ALIPAY_MERCHANT_ID", "merchant")
	t.Setenv("LINGTU_BILLING_ALIPAY_PUBLIC_KEY", pub)
	t.Setenv("LINGTU_BILLING_ALIPAY_PRIVATE_KEY", string(pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(key)})))
	t.Setenv("LINGTU_BILLING_WECHAT_APP_ID", "")
	c := loadBillingConfig()
	if !c.Channels[0].Ready || c.Channels[1].Ready || !c.Ready || len(c.Plans) != 3 {
		t.Fatalf("independent initialization failed %+v", c.Channels)
	}
}

func TestNativeGoPayAlipayAbsentRequiresSignedBusinessResponse(t *testing.T) {
	key, pub := fixtureKey(t)
	private := base64.StdEncoding.EncodeToString(x509.MarshalPKCS1PrivateKey(key))
	client, e := alipay.NewClient("app", private, true)
	if e != nil {
		t.Fatal(e)
	}
	client.AutoVerifySign([]byte(pub))
	valid := true
	transport := fixtureRoundTripper(func(req *http.Request) (*http.Response, error) {
		if req.URL.Host != "openapi.alipay.com" {
			t.Error("nonofficial merchant endpoint", req.URL)
		}
		payload := `{"code":"40004","msg":"Business Failed","sub_code":"ACQ.TRADE_NOT_EXIST","sub_msg":"Trade not exist"}`
		sign := fixtureSign(t, key, payload)
		if !valid {
			sign = "bad"
		}
		envelope, _ := json.Marshal(map[string]interface{}{"alipay_trade_query_response": json.RawMessage(payload), "sign": sign})
		return &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": []string{"application/json"}}, Body: io.NopCloser(bytes.NewReader(envelope))}, nil
	})
	client.SetHttpClient(xhttp.NewClient().SetTransport(alipayVerifiedTransport{base: transport, public: pub}))
	p := &alipayNative{client: client, app: "app", merchant: "merchant", public: pub}
	r, e := p.Query(context.Background(), "order")
	if e != nil || r.State != "absent" {
		t.Fatal("signed absence", r, e)
	}
	valid = false
	if r, e = p.Query(context.Background(), "order"); e == nil || r.State == "absent" {
		t.Fatal("unsigned absence accepted", r, e)
	}
}
func TestNativeGoPayWechatAbsentRequiresSignedBusinessResponse(t *testing.T) {
	key, pub := fixtureKey(t)
	private := string(pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(key)}))
	client, e := wechat.NewClientV3("merchant", "serial", "01234567890123456789012345678901", private)
	if e != nil {
		t.Fatal(e)
	}
	if e = client.AutoVerifySignByPublicKey([]byte(pub), "PUB_KEY_ID_fixture"); e != nil {
		t.Fatal(e)
	}
	valid := true
	client.SetHttpClient(xhttp.NewClient().SetTransport(fixtureRoundTripper(func(req *http.Request) (*http.Response, error) {
		body := `{"code":"ORDER_NOT_EXIST","message":"not found"}`
		ts := strconv.FormatInt(time.Now().Unix(), 10)
		sign := fixtureSign(t, key, ts+"\nnonce\n"+body+"\n")
		if !valid {
			sign = "bad"
		}
		h := http.Header{}
		h.Set("Wechatpay-Timestamp", ts)
		h.Set("Wechatpay-Nonce", "nonce")
		h.Set("Wechatpay-Serial", "PUB_KEY_ID_fixture")
		h.Set("Wechatpay-Signature", sign)
		return &http.Response{StatusCode: 404, Header: h, Body: io.NopCloser(strings.NewReader(body))}, nil
	})))
	p := &wechatNative{client: client, app: "app", merchant: "merchant", keyID: "PUB_KEY_ID_fixture", public: &key.PublicKey}
	r, e := p.Query(context.Background(), "order")
	if e != nil || r.State != "absent" {
		t.Fatal("signed absence", r, e)
	}
	valid = false
	if r, e = p.Query(context.Background(), "order"); e == nil || r.State == "absent" {
		t.Fatal("unsigned absence accepted", r, e)
	}
}
