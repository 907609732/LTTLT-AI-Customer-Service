package lingtuhost

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"net/mail"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/controller"
	"github.com/QuantumNous/new-api/lingtu"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/oauth"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

var adminConfigurationMu sync.Mutex

type configurationRequest struct {
	Section     string `json:"section"`
	AppID       string `json:"app_id"`
	Secret      string `json:"secret"`
	ClearSecret bool   `json:"clear_secret"`
	Enabled     bool   `json:"enabled"`
	Model       string `json:"model"`
	Calls       int    `json:"calls"`
	Days        int    `json:"days"`
	DailyCalls  int    `json:"daily_calls"`
	MaxTokens   int    `json:"max_tokens"`
	PerAccountConcurrent *int `json:"per_account_concurrent"`
	RequestsPerMinute *int `json:"requests_per_minute"`
	GlobalConcurrent *int `json:"global_concurrent"`
	UserID      int    `json:"user_id"`
	ExpiresAt   int64  `json:"expires_at"`
	Status      string `json:"status"`
	Reason      string `json:"reason"`
	Revoke      bool   `json:"revoke"`
	RequestID   string `json:"request_id"`
	Outcome     string `json:"outcome"`
	SMTPServer  string `json:"smtp_server"`
	SMTPAccount string `json:"smtp_account"`
	SMTPFrom    string `json:"smtp_from"`
}

func (h *Host) registerAdmin(router *gin.Engine) {
	admin := router.Group("/api/lingtu/admin", middleware.DisableCache(), middleware.AdminAuth())
	admin.GET("/config", h.adminConfig)
	admin.GET("/accounts", h.adminAccounts)
	admin.GET("/audit", h.adminAudit)
	admin.GET("/usage", h.adminUsage)
	admin.POST("/config", middleware.CriticalRateLimit(), h.saveConfig)
}
func (h *Host) adminConfig(c *gin.Context) {
	policy, err := lingtu.LoadTrialPolicy(model.DB)
	if err != nil {
		clientFailure(c, 503, "configuration_unavailable")
		return
	}
	providers := make([]gin.H, 0, 2)
	for _, name := range []string{"wechat", "dingtalk"} {
		slug := "lt" + name
		var row lingtu.ManagedSetting
		var config lingtu.SocialConfig
		err := model.DB.First(&row, "name = ?", slug).Error
		if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			clientFailure(c, 503, "configuration_unavailable")
			return
		}
		if row.Value != "" && common.UnmarshalJsonStr(row.Value, &config) != nil {
			clientFailure(c, 503, "configuration_unavailable")
			return
		}
		var native model.CustomOAuthProvider
		model.DB.Omit("client_secret").First(&native, "slug = ?", slug)
		providers = append(providers, gin.H{"provider": name, "app_id": config.AppID, "configured": config.Secret != "", "enabled": native.Enabled, "callback": h.portal + "/oauth/" + slug})
	}
	models := make([]gin.H, 0, 2)
	for _, name := range []string{"deepseek", "qwen"} {
		var channel model.Channel
		err := model.DB.First(&channel, "name = ?", "lingtu-"+name).Error
		if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			clientFailure(c, 503, "configuration_unavailable")
			return
		}
		models = append(models, gin.H{"provider": name, "configured": channel.Key != "", "model": channel.Models, "enabled": channel.Status == common.ChannelStatusEnabled && channel.Key != ""})
	}
	common.OptionMapRWMutex.RLock()
	smtp := gin.H{"server": common.OptionMap["SMTPServer"], "account": common.OptionMap["SMTPAccount"], "from": common.OptionMap["SMTPFrom"], "configured": common.OptionMap["SMTPToken"] != "" || common.OptionMap["SMTPPassword"] != ""}
	common.OptionMapRWMutex.RUnlock()
	c.JSON(200, gin.H{"policy": policy, "login_providers": providers, "model_providers": models, "smtp": smtp})
}
func (h *Host) adminAccounts(c *gin.Context) {
	page, _ := strconv.Atoi(c.Query("page"))
	page = max(1, page)
	var accounts []struct {
		UserID      int    `json:"user_id"`
		Status      string `json:"status"`
		Model       string `json:"model"`
		DisplayName string `json:"display_name"`
		Limit       int    `json:"limit" gorm:"column:call_limit"`
		Used        int    `json:"used"`
		Reserved    int    `json:"reserved"`
		ExpiresAt   int64  `json:"expires_at"`
	}
	query := model.DB.Table("lingtu_accounts AS a").Select("a.user_id,a.status,a.model,u.display_name,g.call_limit,g.used,g.reserved,g.expires_at").Joins("JOIN users AS u ON u.id=a.user_id").Joins("JOIN lingtu_trial_grants AS g ON g.user_id=a.user_id")
	var count int64
	if query.Count(&count).Error != nil || query.Order("a.user_id DESC").Offset((page-1)*20).Limit(20).Scan(&accounts).Error != nil {
		clientFailure(c, 503, "temporarily_unavailable")
		return
	}
	c.JSON(200, gin.H{"items": accounts, "total": count, "page": page})
}
func (h *Host) saveConfig(c *gin.Context) {
	// Only interactive native sessions may authorize sensitive configuration writes.
	if _, ok := middleware.GetSessionAuthIdentity(c); !ok {
		clientFailure(c, 403, "interactive_login_required")
		return
	}
	body, err := io.ReadAll(io.LimitReader(c.Request.Body, 32769))
	if err != nil || len(body) > 32768 {
		clientFailure(c, 400, "invalid_request")
		return
	}
	var request configurationRequest
	if common.Unmarshal(body, &request) != nil {
		clientFailure(c, 400, "invalid_request")
		return
	}
	digest := sha256.Sum256(body)
	context, _ := common.Marshal(service.ManagedConfigurationContext{Section: request.Section, RequestHash: hex.EncodeToString(digest[:])})
	if middleware.RequireSecurityProof(c, service.VerificationOperation{Scope: service.VerificationScopeManagedConfigure, Context: context}) == nil {
		return
	}
	adminConfigurationMu.Lock()
	defer adminConfigurationMu.Unlock()
	audit := lingtu.ManagedAudit{ActorID: c.GetInt("id"), TargetID: request.UserID, Section: request.Section, Outcome: "pending", Reason: request.Reason, CreatedAt: time.Now().Unix()}
	if err = model.DB.Create(&audit).Error; err != nil {
		clientFailure(c, 503, "temporarily_unavailable")
		return
	}
	switch request.Section {
	case "wechat", "dingtalk":
		err = h.saveSocial(request)
	case "deepseek", "qwen":
		err = h.saveModel(c, request)
	case "trial":
		policy,loadErr:=lingtu.LoadTrialPolicy(model.DB);if loadErr!=nil{err=loadErr;break}
		policy.Calls=request.Calls;policy.Days=request.Days;policy.DailyCalls=request.DailyCalls;policy.MaxTokens=request.MaxTokens;policy.DefaultModel=request.Model
		if request.PerAccountConcurrent!=nil{policy.PerAccountConcurrent=*request.PerAccountConcurrent};if request.RequestsPerMinute!=nil{policy.RequestsPerMinute=*request.RequestsPerMinute};if request.GlobalConcurrent!=nil{policy.GlobalConcurrent=*request.GlobalConcurrent}
		if policy.Calls < 0 || policy.Calls > 1000000 || policy.Days < 1 || policy.Days > 365 || policy.DailyCalls < 1 || policy.DailyCalls > 100000 || policy.MaxTokens < 1 || policy.MaxTokens > 8192 || policy.PerAccountConcurrent<1||policy.PerAccountConcurrent>4||policy.RequestsPerMinute<1||policy.RequestsPerMinute>120||policy.GlobalConcurrent<1||policy.GlobalConcurrent>16|| (policy.DefaultModel != "deepseek-flash" && policy.DefaultModel != "qwen-plus") {
			err = lingtu.ErrInvalidTrialInput
			break
		}
		var value []byte
		value, err = common.Marshal(policy)
		if err == nil {
			err = putSetting("trial_policy", string(value))
		}
	case "account":
		err = h.saveAccount(request)
	case "reconcile":
		err = h.reconcileUsage(request)
	case "smtp":
		err = h.saveSMTP(request)
	default:
		err = lingtu.ErrInvalidTrialInput
	}
	outcome := "success"
	if err != nil {
		outcome = "failed_or_unconfirmed"
	}
	if auditErr := model.DB.Model(&audit).Update("outcome", outcome).Error; auditErr != nil {
		clientFailure(c, 503, "configuration_update_unconfirmed")
		return
	}
	if err != nil {
		clientFailure(c, 400, "configuration_update_failed")
		return
	}
	c.JSON(200, gin.H{"saved": true})
}
func putSetting(name, value string) error {
	row := lingtu.ManagedSetting{Name: name, Value: value}
	// Save uses a typed struct so encryption runs on both insert and replacement.
	return model.DB.Save(&row).Error
}
func (h *Host) saveSocial(r configurationRequest) error {
	slug := "lt" + r.Section
	var row lingtu.ManagedSetting
	var config lingtu.SocialConfig
	err := model.DB.First(&row, "name = ?", slug).Error
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}
	if row.Value != "" && common.UnmarshalJsonStr(row.Value, &config) != nil {
		return lingtu.ErrInvalidTrialInput
	}
	if r.Secret != "" && r.ClearSecret {
		return lingtu.ErrInvalidTrialInput
	}
	if len(r.Secret) > 2048 || len(r.AppID) > 128 {
		return lingtu.ErrInvalidTrialInput
	}
	if r.ClearSecret {
		config.Secret = ""
	} else if r.Secret != "" {
		config.Secret = r.Secret
	}
	config.Provider = r.Section
	config.AppID = strings.TrimSpace(r.AppID)
	if r.Enabled && (config.AppID == "" || config.Secret == "") {
		return lingtu.ErrInvalidTrialInput
	}
	value, err := common.Marshal(config)
	if err != nil {
		return err
	}
	endpoint := "https://open.weixin.qq.com/connect/qrconnect"
	scope := "snsapi_login"
	name := "微信"
	if r.Section == "dingtalk" {
		endpoint = "https://login.dingtalk.com/oauth2/auth"
		scope = "openid"
		name = "钉钉"
	}
	provider := model.CustomOAuthProvider{Slug: slug, Name: name, ClientId: config.AppID, Enabled: r.Enabled, AuthorizationEndpoint: endpoint, Scopes: scope}
	err = model.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Save(&lingtu.ManagedSetting{Name: slug, Value: string(value)}).Error; err != nil {
			return err
		}
		var current model.CustomOAuthProvider
		if err := tx.First(&current, "slug = ?", slug).Error; err == nil {
			provider.Id = current.Id
		} else if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		return tx.Save(&provider).Error
	})
	if err != nil {
		return err
	}
	oauth.RegisterOrUpdateCustomProvider(&provider)
	return nil
}
func (h *Host) saveModel(c *gin.Context, r configurationRequest) error {
	var channel model.Channel
	err := model.DB.First(&channel, "name = ?", "lingtu-"+r.Section).Error
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}
	if r.Secret != "" && r.ClearSecret {
		return lingtu.ErrInvalidTrialInput
	}
	if len(r.Secret) > 4096 {
		return lingtu.ErrInvalidTrialInput
	}
	if r.ClearSecret {
		channel.Key = ""
	} else if r.Secret != "" {
		channel.Key = strings.TrimSpace(r.Secret)
	}
	channel.Name = "lingtu-" + r.Section
	channel.Type = 1
	channel.Group = "default"
	channel.Status = common.ChannelStatusManuallyDisabled
	base := "https://api.deepseek.com"
	channel.Models = "deepseek-flash"
	override := `{"thinking":{"type":"disabled"}}`
	if r.Section == "qwen" {
		base = "https://dashscope.aliyuncs.com/compatible-mode"
		channel.Models = "qwen-plus"
		override = `{}`
	}
	channel.BaseURL = &base
	channel.ParamOverride = &override
	if r.Enabled {
		if channel.Key == "" {
			return lingtu.ErrInvalidTrialInput
		}
		if err = controller.TestManagedChannel(c.Request.Context(), &channel, c.GetInt("id")); err != nil {
			return err
		}
		channel.Status = common.ChannelStatusEnabled
		channel.TestTime = time.Now().Unix()
	}
	if channel.Id == 0 {
		channel.CreatedTime = time.Now().Unix()
		err = channel.Insert()
	} else {
		// Explicit Save persists a deliberate empty key too; Channel.Update omits it.
		err = model.DB.Save(&channel).Error
		if err == nil {
			err = channel.UpdateAbilities(nil)
		}
	}
	if err == nil {
		model.InitChannelCache()
	}
	return err
}
func (h *Host) saveAccount(r configurationRequest) error {
	if r.UserID <= 0 || r.Calls < 0 || r.Calls > 1000000 || len(strings.TrimSpace(r.Reason)) < 1 || len(r.Reason) > 256 || (r.Status != "enabled" && r.Status != "disabled") || r.ExpiresAt <= 0 {
		return lingtu.ErrInvalidTrialInput
	}
	if r.Model != "" && r.Model != "deepseek-flash" && r.Model != "qwen-plus" {
		return lingtu.ErrInvalidTrialInput
	}
	err := model.DB.Transaction(func(tx *gorm.DB) error {
		var existing lingtu.ManagedAccount
		if err := tx.First(&existing, "user_id = ?", r.UserID).Error; err != nil {
			return err
		}
		account := tx.Model(&lingtu.ManagedAccount{}).Where("user_id = ?", r.UserID).Updates(map[string]any{"status": r.Status, "model": r.Model})
		if account.Error != nil {
			return account.Error
		}
		return tx.Model(&lingtu.TrialGrant{}).Where("user_id = ?", r.UserID).Updates(map[string]any{"call_limit": r.Calls, "expires_at": r.ExpiresAt}).Error
	})
	if err != nil {
		return err
	}
	if r.Revoke || r.Status == "disabled" {
		_, err = model.RevokeAllUserSessions(r.UserID, "managed_admin_revoke")
	}
	return err
}

func (h *Host) adminAudit(c *gin.Context) {
	page, _ := strconv.Atoi(c.Query("page"))
	page = max(1, page)
	var rows []lingtu.ManagedAudit
	var count int64
	if model.DB.Model(&lingtu.ManagedAudit{}).Count(&count).Error != nil || model.DB.Order("id DESC").Offset((page-1)*20).Limit(20).Find(&rows).Error != nil {
		clientFailure(c, 503, "temporarily_unavailable")
		return
	}
	c.JSON(200, gin.H{"items": rows, "total": count, "page": page})
}
func (h *Host) saveSMTP(r configurationRequest) error {
	if r.ClearSecret && r.Secret != "" {
		return lingtu.ErrInvalidTrialInput
	}
	if strings.ContainsAny(r.SMTPServer, "\r\n/ :") || r.SMTPServer == "" || len(r.SMTPServer) > 253 {
		return lingtu.ErrInvalidTrialInput
	}
	if _, err := mail.ParseAddress(r.SMTPAccount); err != nil {
		return lingtu.ErrInvalidTrialInput
	}
	if _, err := mail.ParseAddress(r.SMTPFrom); err != nil {
		return lingtu.ErrInvalidTrialInput
	}
	values := map[string]string{"EmailProvider": "smtp", "SMTPServer": r.SMTPServer, "SMTPAccount": r.SMTPAccount, "SMTPFrom": r.SMTPFrom, "SMTPPort": "465", "SMTPSSLEnabled": "true", "EmailVerificationEnabled": "true"}
	if r.Secret != "" || r.ClearSecret {
		values["SMTPToken"] = r.Secret
	}
	return model.UpdateOptionsBulk(values)
}
