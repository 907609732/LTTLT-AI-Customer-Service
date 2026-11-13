package lingtu

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
)

type SocialConfig struct {
	Provider string
	AppID    string
	Secret   string
}
type SocialSubject struct {
	Subject     string
	DisplayName string
}

var ErrSocialExchange = errors.New("social authorization failed")

// Native bindings may live in a case-insensitive MySQL collation. Hash the
// exact verified subject so distinct opaque IDs can never match via case folding.
func SocialBindingID(provider, subject string) string {
	digest := sha256.Sum256([]byte(provider + "\x00" + subject))
	return hex.EncodeToString(digest[:])
}

func SocialAuthorizationURL(config SocialConfig, state, callback string) (string, error) {
	if state == "" || config.AppID == "" || config.Secret == "" {
		return "", ErrSocialExchange
	}
	values := url.Values{"redirect_uri": {callback}, "response_type": {"code"}, "state": {state}}
	switch config.Provider {
	case "wechat":
		values.Set("appid", config.AppID)
		values.Set("scope", "snsapi_login")
		return "https://open.weixin.qq.com/connect/qrconnect?" + values.Encode() + "#wechat_redirect", nil
	case "dingtalk":
		values.Set("client_id", config.AppID)
		values.Set("scope", "openid")
		values.Set("prompt", "consent")
		return "https://login.dingtalk.com/oauth2/auth?" + values.Encode(), nil
	default:
		return "", ErrSocialExchange
	}
}

// ExchangeSocial only contacts fixed provider endpoints. It never trusts an email or
// nickname as an account identifier and never exposes provider response bodies/errors.
func ExchangeSocial(ctx context.Context, client *http.Client, config SocialConfig, code string) (SocialSubject, error) {
	if code == "" || len(code) > 2048 || config.AppID == "" || len(config.AppID) > 128 || config.Secret == "" {
		return SocialSubject{}, ErrSocialExchange
	}
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	if client == nil {
		client = &http.Client{}
	}
	safeClient := *client
	safeClient.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	switch config.Provider {
	case "wechat":
		values := url.Values{"appid": {config.AppID}, "secret": {config.Secret}, "code": {code}, "grant_type": {"authorization_code"}}
		req, _ := http.NewRequestWithContext(ctx, "GET", "https://api.weixin.qq.com/sns/oauth2/access_token?"+values.Encode(), nil)
		var token struct {
			AccessToken string `json:"access_token"`
			OpenID      string `json:"openid"`
			UnionID     string `json:"unionid"`
			ErrorCode   int    `json:"errcode"`
		}
		if err := socialJSON(&safeClient, req, &token); err != nil || token.ErrorCode != 0 || token.AccessToken == "" || token.OpenID == "" {
			return SocialSubject{}, ErrSocialExchange
		}
		values = url.Values{"access_token": {token.AccessToken}, "openid": {token.OpenID}, "lang": {"zh_CN"}}
		req, _ = http.NewRequestWithContext(ctx, "GET", "https://api.weixin.qq.com/sns/userinfo?"+values.Encode(), nil)
		var profile struct {
			OpenID    string `json:"openid"`
			UnionID   string `json:"unionid"`
			Nickname  string `json:"nickname"`
			ErrorCode int    `json:"errcode"`
		}
		if err := socialJSON(&safeClient, req, &profile); err != nil || profile.ErrorCode != 0 || profile.OpenID != token.OpenID {
			return SocialSubject{}, ErrSocialExchange
		}
		if token.UnionID != "" && profile.UnionID != "" && token.UnionID != profile.UnionID {
			return SocialSubject{}, ErrSocialExchange
		}
		union := profile.UnionID
		if union == "" {
			union = token.UnionID
		}
		subject := "openid:" + token.OpenID
		if union != "" {
			subject = "union:" + union
		}
		if len(subject) > 120 {
			return SocialSubject{}, ErrSocialExchange
		}
		return SocialSubject{Subject: config.AppID + ":" + subject, DisplayName: profile.Nickname}, nil
	case "dingtalk":
		body, err := common.Marshal(map[string]string{"clientId": config.AppID, "clientSecret": config.Secret, "code": code, "grantType": "authorization_code"})
		if err != nil {
			return SocialSubject{}, ErrSocialExchange
		}
		req, _ := http.NewRequestWithContext(ctx, "POST", "https://api.dingtalk.com/v1.0/oauth2/userAccessToken", bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		var token struct {
			AccessToken string `json:"accessToken"`
		}
		if err := socialJSON(&safeClient, req, &token); err != nil || token.AccessToken == "" {
			return SocialSubject{}, ErrSocialExchange
		}
		req, _ = http.NewRequestWithContext(ctx, "GET", "https://api.dingtalk.com/v1.0/contact/users/me", nil)
		req.Header.Set("x-acs-dingtalk-access-token", token.AccessToken)
		var profile struct {
			UnionID  string `json:"unionId"`
			Nickname string `json:"nick"`
		}
		if err := socialJSON(&safeClient, req, &profile); err != nil || profile.UnionID == "" || len(profile.UnionID) > 120 {
			return SocialSubject{}, ErrSocialExchange
		}
		return SocialSubject{Subject: config.AppID + ":union:" + profile.UnionID, DisplayName: profile.Nickname}, nil
	default:
		return SocialSubject{}, ErrSocialExchange
	}
}

func socialJSON(client *http.Client, req *http.Request, out any) error {
	response, err := client.Do(req)
	if err != nil {
		return ErrSocialExchange
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return ErrSocialExchange
	}
	// Read at most 1 MiB; reject excess instead of decoding an accepted prefix.
	body, err := io.ReadAll(io.LimitReader(response.Body, 1024*1024+1))
	if err != nil || len(body) > 1024*1024 {
		return ErrSocialExchange
	}
	if err = common.Unmarshal(body, out); err != nil {
		return ErrSocialExchange
	}
	return nil
}

func SafeSocialName(name string) string {
	runes := []rune(strings.TrimSpace(name))
	if len(runes) > 20 {
		runes = runes[:20]
	}
	return string(runes)
}
