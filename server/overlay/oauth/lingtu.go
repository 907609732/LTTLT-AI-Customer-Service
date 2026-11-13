package oauth

import (
	"context"

	"github.com/QuantumNous/new-api/lingtu"
	"github.com/gin-gonic/gin"
)

// Configured once before the HTTP listener starts. Configuration reads remain
// server-side and fetch/decrypt the latest administrator-owned credential.
var managedProviderResolver func(string) (lingtu.SocialConfig, string, error)

func SetManagedProviderResolver(resolve func(string) (lingtu.SocialConfig, string, error)) {
	managedProviderResolver = resolve
}
func managedProviderKind(slug string) string {
	switch slug {
	case "ltwechat":
		return "wechat"
	case "ltdingtalk":
		return "dingtalk"
	}
	return ""
}
func (p *GenericOAuthProvider) ManagedAuthorizationURL(state string) (string, error) {
	if managedProviderKind(p.config.Slug) == "" {
		return "", nil
	}
	if managedProviderResolver == nil {
		return "", lingtu.ErrSocialExchange
	}
	config, callback, err := managedProviderResolver(p.config.Slug)
	if err != nil {
		return "", lingtu.ErrSocialExchange
	}
	return lingtu.SocialAuthorizationURL(config, state, callback)
}
func (p *GenericOAuthProvider) exchangeManaged(ctx context.Context, code string, _ *gin.Context) (*OAuthToken, error) {
	if managedProviderResolver == nil {
		return nil, lingtu.ErrSocialExchange
	}
	config, _, err := managedProviderResolver(p.config.Slug)
	if err != nil {
		return nil, lingtu.ErrSocialExchange
	}
	subject, err := lingtu.ExchangeSocial(ctx, nil, config, code)
	if err != nil {
		return nil, err
	}
	return &OAuthToken{ManagedUser: &OAuthUser{ProviderUserID: lingtu.SocialBindingID(config.Provider, subject.Subject), DisplayName: lingtu.SafeSocialName(subject.DisplayName)}}, nil
}
