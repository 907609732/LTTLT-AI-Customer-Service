package lingtuhost

import (
	"errors"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/lingtu"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/oauth"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type Host struct {
	trials      *lingtu.TrialStore
	cleanupStop chan struct{}
	cleanupOnce sync.Once
	sessions    *lingtu.SessionStore
	devices     *lingtu.DeviceStore
	portal      string
	apiOrigin   string
}

func Register(router *gin.Engine) error {
	apiOrigin, err := common.NormalizeOrigin(os.Getenv("LINGTU_API_ORIGIN"))
	if err != nil {
		return errors.New("LINGTU_API_ORIGIN must be configured")
	}
	portal, err := common.NormalizeOrigin(os.Getenv("LINGTU_PORTAL_ORIGIN"))
	if err != nil {
		return errors.New("LINGTU_PORTAL_ORIGIN must be configured")
	}
	if !strings.HasPrefix(apiOrigin, "https://") || !strings.HasPrefix(portal, "https://") || !common.SessionCookieSecure {
		return errors.New("managed service requires HTTPS origins and secure session cookies")
	}
	vault, err := lingtu.RuntimeVault()
	if err != nil {
		return err
	}
	h := &Host{portal: portal, apiOrigin: apiOrigin, trials: lingtu.NewTrialStore(model.DB)}
	h.sessions = lingtu.NewSessionStore(model.DB, vault, apiOrigin, validateNativeSession)
	h.devices = lingtu.NewDeviceStore(model.DB, vault, h.sessions, portal+"/lingtu/device")
	if err = h.sessions.Migrate(); err != nil {
		return err
	}
	if err = h.devices.Migrate(); err != nil {
		return err
	}
	if err = h.migrateChat(); err != nil {
		return err
	}
	h.startChatCleanup()
	oauth.SetManagedProviderResolver(h.socialConfig)
	group := router.Group("/api/client", middleware.DisableCache(), middleware.GlobalAPIRateLimit())
	group.Use(func(c *gin.Context) {
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 1024*1024)
		c.Next()
	})
	group.POST("/auth/device/authorize", middleware.LingtuIPRateLimit("device-authorize", 10, 60), h.authorize)
	group.POST("/auth/device/token", middleware.LingtuIPRateLimit("device-poll", 120, 60), h.poll)
	group.POST("/auth/refresh", middleware.LingtuIPRateLimit("client-refresh", 120, 60), h.refresh)
	authenticated := group.Group("", h.clientAuth)
	authenticated.POST("/chat/completions", h.prepareChat, h.injectInternalToken, middleware.TokenAuth(), middleware.Distribute(), h.nativeChat)
	authenticated.GET("/me", h.me)
	authenticated.GET("/config", h.config)
	authenticated.POST("/auth/logout", h.logout)
	browser := router.Group("/api/lingtu", middleware.DisableCache(), middleware.UserAuth())
	browser.POST("/device/approve", middleware.LingtuCriticalRateLimit("device-approve"), h.approve)
	browser.GET("/account", h.browserAccount)
	h.registerAdmin(router)
	return nil
}

func validateNativeSession(uid int, sid string, version int64) error {
	var session model.UserSession
	if err := model.DB.First(&session, "sid = ?", sid).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return lingtu.ErrSessionInvalid
		}
		return err
	}
	if session.UserID != uid || session.Status != model.UserSessionStatusActive || session.RevokedAt != 0 || session.ExpiresAt <= time.Now().Unix() || session.UserAuthVersion != version {
		return lingtu.ErrSessionInvalid
	}
	var user model.User
	if err := model.DB.Select("id", "status", "auth_version").First(&user, uid).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return lingtu.ErrSessionInvalid
		}
		return err
	}
	if user.Status != common.UserStatusEnabled || user.AuthVersion != version {
		return lingtu.ErrSessionInvalid
	}
	return nil
}
func clientFailure(c *gin.Context, status int, code string) {
	c.AbortWithStatusJSON(status, gin.H{"error": code})
}
func (h *Host) authorize(c *gin.Context) {
	flow, err := h.devices.Authorize(time.Now())
	if err != nil {
		clientFailure(c, 503, "temporarily_unavailable")
		return
	}
	c.JSON(200, flow)
}
func (h *Host) poll(c *gin.Context) {
	var request struct {
		DeviceCode string `json:"device_code"`
		GrantType  string `json:"grant_type"`
	}
	if c.ShouldBindJSON(&request) != nil || request.GrantType != "urn:ietf:params:oauth:grant-type:device_code" {
		clientFailure(c, 400, "invalid_request")
		return
	}
	bundle, err := h.devices.Poll(request.DeviceCode, time.Now())
	if err != nil {
		switch {
		case errors.Is(err, lingtu.ErrAuthorizationPending):
			clientFailure(c, 400, "authorization_pending")
		case errors.Is(err, lingtu.ErrSlowDown):
			clientFailure(c, 400, "slow_down")
		case errors.Is(err, lingtu.ErrDeviceExpired):
			clientFailure(c, 400, "expired_token")
		default:
			clientFailure(c, 400, "invalid_grant")
		}
		return
	}
	c.JSON(200, bundle)
}
func (h *Host) refresh(c *gin.Context) {
	var request struct {
		RefreshToken string `json:"refresh_token"`
		Operation    string `json:"operation_id"`
	}
	if c.ShouldBindJSON(&request) != nil {
		clientFailure(c, 400, "invalid_request")
		return
	}
	bundle, err := h.sessions.Refresh(request.RefreshToken, request.Operation, time.Now())
	if err != nil {
		if errors.Is(err, lingtu.ErrSessionInvalid) {
			clientFailure(c, 401, "invalid_grant")
		} else {
			clientFailure(c, 503, "temporarily_unavailable")
		}
		return
	}
	c.JSON(200, bundle)
}
func (h *Host) clientAuth(c *gin.Context) {
	auth := c.GetHeader("Authorization")
	if !strings.HasPrefix(auth, "Bearer ") {
		clientFailure(c, 401, "unauthorized")
		return
	}
	identity, err := h.sessions.Authenticate(strings.TrimPrefix(auth, "Bearer "), time.Now())
	if err != nil {
		if errors.Is(err, lingtu.ErrSessionInvalid) {
			clientFailure(c, 401, "session_expired")
		} else {
			clientFailure(c, 503, "temporarily_unavailable")
		}
		return
	}
	var account lingtu.ManagedAccount
	if model.DB.First(&account, "user_id = ?", identity.UserID).Error != nil || account.Status != "enabled" {
		clientFailure(c, 403, "account_disabled")
		return
	}
	c.Set("lingtu_identity", identity)
	c.Next()
}
func identityOf(c *gin.Context) lingtu.ClientIdentity {
	return c.MustGet("lingtu_identity").(lingtu.ClientIdentity)
}
func (h *Host) me(c *gin.Context)             { h.accountResponse(c, identityOf(c).UserID) }
func (h *Host) browserAccount(c *gin.Context) { h.accountResponse(c, c.GetInt("id")) }
func (h *Host) accountResponse(c *gin.Context, uid int) {
	var user model.User
	var grant lingtu.TrialGrant
	var account lingtu.ManagedAccount
	if model.DB.Select("id", "display_name").First(&user, uid).Error != nil || model.DB.First(&grant, "user_id = ?", uid).Error != nil || model.DB.First(&account, "user_id = ?", uid).Error != nil {
		clientFailure(c, 404, "account_not_ready")
		return
	}
	c.JSON(200, gin.H{"user_id": uid, "display_name": user.DisplayName, "status": account.Status, "trial": gin.H{"limit": grant.Limit, "used": grant.Used, "reserved": grant.Reserved, "remaining": max(0, grant.Limit-grant.Used-grant.Reserved), "expires_at": grant.ExpiresAt}})
}
func (h *Host) config(c *gin.Context) {
	policy, err := lingtu.LoadTrialPolicy(model.DB)
	if err != nil {
		clientFailure(c, 503, "configuration_unavailable")
		return
	}
	var account lingtu.ManagedAccount
	if model.DB.First(&account, "user_id = ?", identityOf(c).UserID).Error != nil {
		clientFailure(c, 403, "account_disabled")
		return
	}
	selected := account.Model
	if selected == "" {
		selected = policy.DefaultModel
	}
	// Only display/selection policy; no upstream URL, channel or credential is serialized.
	c.JSON(200, gin.H{"default_model": selected, "models": []gin.H{{"id": selected, "name": selected}}, "max_tokens": policy.MaxTokens})
}
func (h *Host) approve(c *gin.Context) {
	identity, ok := middleware.GetSessionAuthIdentity(c)
	if !ok {
		clientFailure(c, 401, "unauthorized")
		return
	}
	var request struct {
		UserCode string `json:"user_code"`
	}
	if c.ShouldBindJSON(&request) != nil || len(request.UserCode) != 9 {
		clientFailure(c, 400, "invalid_request")
		return
	}
	deadline, err := deviceApprovalDeadline(identity)
	if err != nil {
		clientFailure(c, 403, "login_not_available")
		return
	}
	// A fresh native session gets its own revoke control. Its dashboard bundle and
	// refresh secret stay server-side; only the restricted desktop bundle is redeemed.
	bundle, err := service.CreateLoginSessionAtAuthVersion(identity.UserID, identity.UserAuthVersion, "lingtu-client", c.ClientIP(), c.Request.UserAgent())
	if err != nil {
		clientFailure(c, 403, "login_not_available")
		return
	}
	deadline = min(deadline, bundle.Session.ExpiresAt)
	if err = model.DB.Model(&model.UserSession{}).Where("sid = ?", bundle.Session.SID).UpdateColumn("expires_at", deadline).Error; err == nil {
		err = h.devices.Approve(request.UserCode, identity.UserID, bundle.Session.SID, identity.UserAuthVersion, time.Now(), deadline)
	}
	if err != nil {
		_, _ = model.RevokeUserSession(identity.UserID, bundle.Session.SID, "device_approval_failed")
		clientFailure(c, 400, "invalid_grant")
		return
	}
	c.JSON(200, gin.H{"approved": true})
}

// Device confirmation delegates an existing authentication; it is not a new
// authentication and must inherit the browser session's absolute deadline.
func deviceApprovalDeadline(identity service.AuthIdentity) (int64, error) {
	if err := validateNativeSession(identity.UserID, identity.SessionID, identity.UserAuthVersion); err != nil {
		return 0, err
	}
	var source model.UserSession
	if err := model.DB.First(&source, "sid = ?", identity.SessionID).Error; err != nil {
		return 0, err
	}
	if source.Version != identity.SessionVersion || source.Status != model.UserSessionStatusActive || source.RevokedAt != 0 || source.ExpiresAt <= time.Now().Unix() {
		return 0, lingtu.ErrSessionInvalid
	}
	if err := lingtu.EnsureManagedAccount(model.DB, identity.UserID, time.Now()); err != nil {
		return 0, err
	}
	var account lingtu.ManagedAccount
	if err := model.DB.First(&account, "user_id = ?", identity.UserID).Error; err != nil {
		return 0, err
	}
	if account.Status != "enabled" {
		return 0, lingtu.ErrSessionInvalid
	}
	return source.ExpiresAt, nil
}
func (h *Host) logout(c *gin.Context) {
	identity := identityOf(c)
	if _, err := model.RevokeUserSession(identity.UserID, identity.SID, "client_logout"); err != nil {
		clientFailure(c, 503, "temporarily_unavailable")
		return
	}
	c.JSON(200, gin.H{"revoked": true})
}
func (h *Host) socialConfig(slug string) (lingtu.SocialConfig, string, error) {
	var config lingtu.SocialConfig
	var row lingtu.ManagedSetting
	if slug != "ltwechat" && slug != "ltdingtalk" {
		return config, "", lingtu.ErrSocialExchange
	}
	if err := model.DB.First(&row, "name = ?", slug).Error; err != nil {
		return config, "", lingtu.ErrSocialExchange
	}
	if common.UnmarshalJsonStr(row.Value, &config) != nil || config.AppID == "" || config.Secret == "" {
		return config, "", lingtu.ErrSocialExchange
	}
	return config, h.portal + "/oauth/" + slug, nil
}
