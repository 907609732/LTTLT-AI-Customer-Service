package lingtu

import (
	"context"
	"io"
	"net/http"
	"strings"
	"testing"
)

type socialTransport func(*http.Request) (*http.Response, error)

func (f socialTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func TestSocialProtocolUsesVerifiedSubjectWithoutEmailMerge(t *testing.T) {
	for _, kind := range []string{"wechat", "dingtalk"} {
		t.Run(kind, func(t *testing.T) {
			calls := 0
			client := &http.Client{Transport: socialTransport(func(r *http.Request) (*http.Response, error) {
				calls++
				body := ""
				if kind == "wechat" {
					if calls == 1 {
						if r.Method != "GET" || r.URL.Query().Get("secret") != "fixture-secret" || r.URL.Query().Get("code") != "fixture-code" {
							t.Fatal("invalid WeChat exchange")
						}
						body = `{"access_token":"provider-token","openid":"open-9","unionid":"union-9"}`
					} else {
						if r.URL.Query().Get("access_token") != "provider-token" || r.URL.Query().Get("openid") != "open-9" {
							t.Fatal("invalid WeChat profile")
						}
						body = `{"openid":"open-9","unionid":"union-9","nickname":"Shop owner"}`
					}
				} else {
					if calls == 1 {
						raw, _ := io.ReadAll(r.Body)
						if r.Method != "POST" || !strings.Contains(string(raw), `"clientSecret":"fixture-secret"`) {
							t.Fatal("invalid DingTalk exchange")
						}
						body = `{"accessToken":"provider-token"}`
					} else {
						if r.Header.Get("x-acs-dingtalk-access-token") != "provider-token" {
							t.Fatal("invalid DingTalk profile")
						}
						body = `{"unionId":"union-9","nick":"Shop owner","email":"unverified@example.com"}`
					}
				}
				return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(body)), Header: make(http.Header)}, nil
			})}
			subject, err := ExchangeSocial(context.Background(), client, SocialConfig{Provider: kind, AppID: "app-9", Secret: "fixture-secret"}, "fixture-code")
			if err != nil || subject.Subject != "app-9:union:union-9" || calls != 2 {
				t.Fatal(subject, err, calls)
			}
		})
	}
}
func TestSocialErrorsDoNotExposeCredentialsOrAcceptMissingIdentity(t *testing.T) {
	for _, body := range []string{`{"errcode":40029,"errmsg":"fixture-secret"}`, `{"access_token":"provider-token"}`, `{"accessToken":"provider-token"}`} {
		c := &http.Client{Transport: socialTransport(func(*http.Request) (*http.Response, error) {
			return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(body)), Header: make(http.Header)}, nil
		})}
		_, err := ExchangeSocial(context.Background(), c, SocialConfig{Provider: "wechat", AppID: "app", Secret: "fixture-secret"}, "code")
		if err == nil || strings.Contains(err.Error(), "fixture-secret") || strings.Contains(err.Error(), "provider-token") {
			t.Fatal(err)
		}
	}
}

func TestSocialBindingIDsRemainDistinctWithCaseInsensitiveDatabaseCollation(t *testing.T) {
	first := SocialBindingID("wechat", "app:openid:AbC")
	second := SocialBindingID("wechat", "app:openid:abc")
	if len(first) != 64 || strings.EqualFold(first, second) {
		t.Fatal("case-distinct provider subjects alias one account")
	}
	if first == SocialBindingID("dingtalk", "app:openid:AbC") {
		t.Fatal("provider namespaces alias")
	}
}
