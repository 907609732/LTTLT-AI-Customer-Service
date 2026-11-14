package lingtuhost

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"regexp"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/lingtu"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
	"github.com/stripe/stripe-go/v81"
	"github.com/stripe/stripe-go/v81/account"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type billingServiceInfo struct {
	Version         string   `json:"version"`
	BillingProtocol int      `json:"billing_protocol"`
	Capabilities    []string `json:"capabilities"`
}

func billingServiceVersion() billingServiceInfo {
	return billingServiceInfo{Version: "2026.11.14-billing.2", BillingProtocol: 2, Capabilities: []string{"billing-orders", "stripe-signed-credit", "encrypted-billing-settings", "billing-merchant-check"}}
}

// Stored only inside ManagedSetting's authenticated encryption serializer.
type billingSettings struct {
	Revision      int                  `json:"revision"`
	Enabled       bool                 `json:"enabled"`
	SecretKey     string               `json:"secret_key"`
	WebhookSecret string               `json:"webhook_secret"`
	Plans         []lingtu.BillingPlan `json:"plans"`
}

var billingSecretKeyPattern = regexp.MustCompile(`^sk_(test|live)_[a-zA-Z0-9_]{1,480}$`)
var billingWebhookPattern = regexp.MustCompile(`^whsec_[a-zA-Z0-9_]{1,480}$`)
var errBillingRevision = errors.New("billing configuration revision conflict")

func validBillingPlans(plans []lingtu.BillingPlan) bool {
	if len(plans) > 20 {
		return false
	}
	seen := map[string]bool{}
	for _, plan := range plans {
		if !plan.Valid() || seen[plan.ID] {
			return false
		}
		seen[plan.ID] = true
	}
	return true
}
func strictBillingJSON(raw []byte, value interface{}) error {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(value); err != nil {
		return err
	}
	var trailing interface{}
	if decoder.Decode(&trailing) != io.EOF {
		return lingtu.ErrBillingInput
	}
	return nil
}
func billingEnvironmentSettings() billingSettings {
	settings := billingSettings{Enabled: true, SecretKey: os.Getenv("LINGTU_BILLING_STRIPE_SECRET_KEY"), WebhookSecret: os.Getenv("LINGTU_BILLING_STRIPE_WEBHOOK_SECRET"), Plans: []lingtu.BillingPlan{}}
	var plans []lingtu.BillingPlan
	if strictBillingJSON([]byte(os.Getenv("LINGTU_BILLING_PLANS")), &plans) == nil && validBillingPlans(plans) {
		settings.Plans = plans
	}
	return settings
}
func loadBillingSettings(db *gorm.DB) (billingSettings, string, error) {
	var row lingtu.ManagedSetting
	err := db.First(&row, "name = ?", "billing_stripe").Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return billingEnvironmentSettings(), "environment", nil
	}
	if err != nil {
		return billingSettings{}, "database", err
	}
	var settings billingSettings
	if strictBillingJSON([]byte(row.Value), &settings) != nil || settings.Revision < 1 || !validBillingPlans(settings.Plans) {
		return billingSettings{}, "database", lingtu.ErrBillingInput
	}
	if settings.Plans == nil {
		settings.Plans = []lingtu.BillingPlan{}
	}
	return settings, "database", nil
}
func billingPublicConfig(settings billingSettings) billingConfig {
	c := billingConfig{Plans: []lingtu.BillingPlan{}, Reason: "payment_not_configured", key: settings.SecretKey, secret: settings.WebhookSecret, Service: billingServiceVersion()}
	if !settings.Enabled || !billingSecretKeyPattern.MatchString(settings.SecretKey) || !billingWebhookPattern.MatchString(settings.WebhookSecret) {
		return c
	}
	if len(settings.Plans) == 0 || !validBillingPlans(settings.Plans) {
		c.Reason = "plans_not_configured"
		return c
	}
	c.Ready = true
	c.Reason = ""
	c.Plans = settings.Plans
	return c
}
func billingSettingsView(settings billingSettings, source string) gin.H {
	mode := "unconfigured"
	if strings.HasPrefix(settings.SecretKey, "sk_test_") {
		mode = "test"
	} else if strings.HasPrefix(settings.SecretKey, "sk_live_") {
		mode = "live"
	}
	return gin.H{"revision": settings.Revision, "enabled": settings.Enabled, "source": source, "mode": mode, "secret_key_configured": settings.SecretKey != "", "webhook_secret_configured": settings.WebhookSecret != "", "plans": settings.Plans, "ready": billingPublicConfig(settings).Ready, "reason": billingPublicConfig(settings).Reason, "service": billingServiceVersion(), "webhook_path": "/api/lingtu/billing/stripe/webhook", "merchant_verified": false, "webhook_verified": false}
}
func (h *billingHost) adminBillingConfig(c *gin.Context) {
	settings, source, err := loadBillingSettings(h.db)
	if err != nil {
		clientFailure(c, 503, "billing_unavailable")
		return
	}
	c.JSON(200, billingSettingsView(settings, source))
}

type billingSettingsRequest struct {
	Section            string               `json:"section"`
	Revision           int                  `json:"revision"`
	Enabled            bool                 `json:"enabled"`
	SecretKey          string               `json:"secret_key"`
	WebhookSecret      string               `json:"webhook_secret"`
	ClearSecretKey     bool                 `json:"clear_secret_key"`
	ClearWebhookSecret bool                 `json:"clear_webhook_secret"`
	Plans              []lingtu.BillingPlan `json:"plans"`
}

func (h *billingHost) saveBillingSettings(input billingSettingsRequest, actor int) error {
	if input.Section != "billing" || input.Revision < 0 || !validBillingPlans(input.Plans) || (input.SecretKey != "" && (!billingSecretKeyPattern.MatchString(input.SecretKey) || !strings.HasPrefix(input.SecretKey, "sk_test_") || input.ClearSecretKey)) || (input.WebhookSecret != "" && (!billingWebhookPattern.MatchString(input.WebhookSecret) || input.ClearWebhookSecret)) {
		return lingtu.ErrBillingInput
	}
	adminConfigurationMu.Lock()
	defer adminConfigurationMu.Unlock()
	return h.db.Transaction(func(tx *gorm.DB) error {
		current, source, err := loadBillingSettings(tx.Clauses(clause.Locking{Strength: "UPDATE"}))
		if err != nil {
			return err
		}
		if current.Revision != input.Revision {
			return errBillingRevision
		}
		if input.SecretKey != "" {
			current.SecretKey = input.SecretKey
		}
		if input.WebhookSecret != "" {
			current.WebhookSecret = input.WebhookSecret
		}
		if input.ClearSecretKey {
			current.SecretKey = ""
		}
		if input.ClearWebhookSecret {
			current.WebhookSecret = ""
		}
		// The administration flow configures a sandbox only; live environment remains explicit operations configuration.
		if current.SecretKey != "" && !strings.HasPrefix(current.SecretKey, "sk_test_") {
			return lingtu.ErrBillingInput
		}
		current.Enabled = input.Enabled && !input.ClearSecretKey && !input.ClearWebhookSecret
		current.Plans = input.Plans
		if current.Plans == nil {
			current.Plans = []lingtu.BillingPlan{}
		}
		if current.Enabled && !billingPublicConfig(current).Ready {
			return lingtu.ErrBillingInput
		}
		current.Revision++
		raw, err := json.Marshal(current)
		if err != nil {
			return err
		}
		row := lingtu.ManagedSetting{Name: "billing_stripe", Value: string(raw)}
		if source == "database" {
			err = tx.Save(&row).Error
		} else {
			err = tx.Create(&row).Error
		}
		if err != nil {
			return err
		}
		return tx.Create(&lingtu.ManagedAudit{ActorID: actor, Section: "billing", Outcome: "success", CreatedAt: time.Now().Unix()}).Error
	})
}
func (h *billingHost) adminSaveBilling(c *gin.Context) {
	if _, ok := middleware.GetSessionAuthIdentity(c); !ok {
		clientFailure(c, 403, "interactive_login_required")
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 32768)
	body, err := io.ReadAll(c.Request.Body)
	var input billingSettingsRequest
	if err != nil || strictBillingJSON(body, &input) != nil {
		clientFailure(c, 400, "invalid_request")
		return
	}
	digest := sha256.Sum256(body)
	context, _ := json.Marshal(service.ManagedConfigurationContext{Section: "billing", RequestHash: hex.EncodeToString(digest[:])})
	if middleware.RequireSecurityProof(c, service.VerificationOperation{Scope: service.VerificationScopeManagedConfigure, Context: context}) == nil {
		return
	}
	if err = h.saveBillingSettings(input, c.GetInt("id")); err != nil {
		if errors.Is(err, errBillingRevision) {
			clientFailure(c, 409, "billing_configuration_conflict")
			return
		}
		if errors.Is(err, lingtu.ErrBillingInput) {
			clientFailure(c, 400, "invalid_billing_configuration")
			return
		}
		clientFailure(c, 503, "configuration_update_unconfirmed")
		return
	}
	settings, source, err := loadBillingSettings(h.db)
	if err != nil {
		clientFailure(c, 503, "configuration_update_unconfirmed")
		return
	}
	c.JSON(200, gin.H{"saved": true, "configuration": billingSettingsView(settings, source)})
}
func (h *billingHost) adminCheckBilling(c *gin.Context) {
	settings, _, err := loadBillingSettings(h.db)
	if err != nil {
		clientFailure(c, 503, "billing_unavailable")
		return
	}
	// This is a read-only account probe, never a checkout/payment or ledger mutation.
	if !strings.HasPrefix(settings.SecretKey, "sk_test_") || !billingSecretKeyPattern.MatchString(settings.SecretKey) {
		clientFailure(c, 503, "merchant_test_not_configured")
		return
	}
	merchant, err := (account.Client{B: h.stripeBackend(), Key: settings.SecretKey}).Get()
	if err != nil || merchant == nil || merchant.ID == "" {
		clientFailure(c, 503, "merchant_test_failed")
		return
	}
	for _, table := range []interface{}{&lingtu.BillingOrder{}, &lingtu.BillingCredit{}, &lingtu.TrialGrant{}} {
		rows, err := h.db.Model(table).Select("1").Limit(1).Rows()
		if err != nil {
			clientFailure(c, 503, "billing_unavailable")
			return
		}
		rows.Close()
	}
	c.JSON(200, gin.H{"merchant": "verified", "mode": "test", "ledger": "available", "webhook": "not_verified", "payment": "not_tested", "checked_at": time.Now().Unix(), "service": billingServiceVersion()})
}

func (h *billingHost) stripeBackend() stripe.Backend {
	if h.backend != nil {
		return h.backend
	}
	// SDK failures can contain provider response text. Return only stable codes;
	// never log provider bodies, request headers or merchant credentials.
	return stripe.GetBackendWithConfig(stripe.APIBackend, &stripe.BackendConfig{HTTPClient: &http.Client{Timeout: 15 * time.Second}, MaxNetworkRetries: stripe.Int64(0), LeveledLogger: &stripe.LeveledLogger{Level: stripe.LevelNull}})
}
