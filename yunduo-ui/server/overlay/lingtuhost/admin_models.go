package lingtuhost

import (
	"context"
	"crypto/sha256"
	"crypto/x509"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"errors"
	"net"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/controller"
	"github.com/QuantumNous/new-api/lingtu"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type modelConnectionView struct {
	ConnectionID  int    `json:"connection_id"`
	Provider      string `json:"provider"`
	Name          string `json:"name"`
	ModelID       string `json:"model_id"`
	BaseURL       string `json:"base_url"`
	UpstreamModel string `json:"upstream_model"`
	APIVersion    string `json:"api_version"`
	Region        string `json:"region"`
	AccountID     string `json:"account_id"`
	Configured    bool   `json:"configured"`
	Enabled       bool   `json:"enabled"`
	Ready         bool   `json:"ready"`
	IsDefault     bool   `json:"is_default"`
	Revision      int    `json:"revision"`
	TestStatus    string `json:"test_status"`
	TestedAt      int64  `json:"tested_at"`
}

func channelHash(ch model.Channel) string {
	stringValue := func(value *string) string {
		if value == nil {
			return ""
		}
		return *value
	}
	raw, _ := json.Marshal([]any{ch.Type, ch.Key, stringValue(ch.BaseURL), ch.GetBaseURL(), ch.Models, ch.Other, ch.OtherSettings, stringValue(ch.ParamOverride), stringValue(ch.ModelMapping), ch.ChannelInfo, ch.Group, stringValue(ch.HeaderOverride), stringValue(ch.Setting), stringValue(ch.OpenAIOrganization), ch.GetStatusCodeMapping(), ch.GetAutoBan()})
	hash := sha256.Sum256(raw)
	return hex.EncodeToString(hash[:])
}
func credentialConfigured(p modelProvider, ch model.Channel) bool {
	return p.Category == "selfhost" || strings.TrimSpace(ch.Key) != ""
}
func legacyConnections(db *gorm.DB) ([]lingtu.ModelConnection, error) {
	result := []lingtu.ModelConnection{}
	for _, old := range []struct{ name, provider, alias string }{{"deepseek", "deepseek", "deepseek-flash"}, {"qwen", "qwen", "qwen-plus"}, {"qwen-vision", "qwen", visionModel}} {
		var ch model.Channel
		err := db.First(&ch, "name = ?", "lingtu-"+old.name).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			continue
		}
		if err != nil {
			return nil, err
		}
		row := lingtu.ModelConnection{ChannelID: ch.Id, Provider: old.provider, Name: old.name, ModelID: old.alias, Enabled: ch.Status == common.ChannelStatusEnabled, Revision: 1, ConfigHash: channelHash(ch), TestStatus: "never"}
		if ch.TestTime > 0 {
			row.TestStatus = "success"
			row.TestedAt = ch.TestTime
			row.TestedHash = row.ConfigHash
		}
		result = append(result, row)
	}
	return result, nil
}
func migrateLegacyModelConnections(tx *gorm.DB) error {
	rows, err := legacyConnections(tx)
	if err != nil {
		return err
	}
	for _, row := range rows {
		if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&row).Error; err != nil {
			return err
		}
	}
	return nil
}
func syncLegacyModelBinding(tx *gorm.DB, ch *model.Channel) error {
	rows, err := legacyConnections(tx)
	if err != nil {
		return err
	}
	for _, next := range rows {
		if next.ChannelID != ch.Id {
			continue
		}
		var old lingtu.ModelConnection
		err := tx.First(&old, ch.Id).Error
		if err == nil {
			next.Name = old.Name
			next.Revision = old.Revision
			if old.ConfigHash != next.ConfigHash || old.Enabled != next.Enabled {
				next.Revision++
			}
		} else if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		return tx.Save(&next).Error
	}
	return lingtu.ErrInvalidTrialInput
}
func loadModelConnectionRows(db *gorm.DB) ([]lingtu.ModelConnection, error) {
	rows := []lingtu.ModelConnection{}
	if err := db.Order("channel_id").Find(&rows).Error; err != nil {
		return nil, err
	}
	old, err := legacyConnections(db)
	if err != nil {
		return nil, err
	}
	for _, r := range old {
		found := false
		for _, existing := range rows {
			if existing.ChannelID == r.ChannelID || existing.ModelID == r.ModelID {
				found = true
				break
			}
		}
		if !found {
			rows = append(rows, r)
		}
	}
	return rows, nil
}
func modelConnectionViews(db *gorm.DB, selected string) ([]modelConnectionView, error) {
	rows, err := loadModelConnectionRows(db)
	if err != nil {
		return nil, err
	}
	result := []modelConnectionView{}
	for _, row := range rows {
		var ch model.Channel
		if err := db.First(&ch, row.ChannelID).Error; err != nil {
			return nil, err
		}
		p, ok := managedProvider(row.Provider)
		if !ok {
			return nil, lingtu.ErrInvalidTrialInput
		}
		status := row.TestStatus
		testedAt := row.TestedAt
		if row.ConfigHash != channelHash(ch) || (row.TestedHash != "" && row.TestedHash != row.ConfigHash) {
			status = "stale"
			testedAt = 0
		}
		v := modelConnectionView{ConnectionID: ch.Id, Provider: row.Provider, Name: row.Name, ModelID: row.ModelID, BaseURL: ch.GetBaseURL(), UpstreamModel: ch.Models, Configured: credentialConfigured(p, ch), Enabled: row.Enabled, Ready: row.Enabled && ch.Status == common.ChannelStatusEnabled && row.ConfigHash == channelHash(ch) && credentialConfigured(p, ch), IsDefault: selected == row.ModelID, Revision: row.Revision, TestStatus: status, TestedAt: testedAt}
		switch row.Provider {
		case "azure":
			v.APIVersion = ch.Other
		case "vertex":
			v.Region = ch.Other
		case "cloudflare":
			v.AccountID = ch.Other
		}
		result = append(result, v)
	}
	return result, nil
}

func publicModelIP(ip net.IP) bool {
	return ip != nil && ip.IsGlobalUnicast() && !ip.IsPrivate() && !ip.IsLoopback() && !ip.IsLinkLocalUnicast() && !ip.IsLinkLocalMulticast() && !ip.IsUnspecified() && !(ip.To4() != nil && (ip.To4()[0] == 0 || ip.To4()[0] == 100 && ip.To4()[1] >= 64 && ip.To4()[1] <= 127 || ip.To4()[0] >= 224))
}
func validateModelURL(p modelProvider, base string, resolve bool) error {
	if p.Provider == "bedrock" {
		if base != "" {
			return lingtu.ErrInvalidTrialInput
		}
		return nil
	}
	u, err := url.Parse(base)
	if err != nil || u.Host == "" || u.Hostname() == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || u.Opaque != "" || strings.ContainsAny(base, "\r\n\\") || len(base) > 2048 {
		return lingtu.ErrInvalidTrialInput
	}
	if u.Scheme != "https" && (p.Category != "selfhost" || u.Scheme != "http") {
		return lingtu.ErrInvalidTrialInput
	}
	if p.Provider == "spark" && strings.TrimRight(base, "/") != p.BaseURL {
		return lingtu.ErrInvalidTrialInput
	}
	if p.Category == "selfhost" {
		return nil
	}
	host := strings.ToLower(strings.TrimSuffix(u.Hostname(), "."))
	if host == "localhost" || !strings.Contains(host, ".") || strings.HasSuffix(host, ".localhost") || strings.HasSuffix(host, ".local") || strings.HasSuffix(host, ".internal") {
		return lingtu.ErrInvalidTrialInput
	}
	if ip := net.ParseIP(host); ip != nil {
		if !publicModelIP(ip) {
			return lingtu.ErrInvalidTrialInput
		}
		return nil
	}
	numeric := true
	for _, r := range host {
		if (r < '0' || r > '9') && r != '.' {
			numeric = false
			break
		}
	}
	if numeric || strings.HasPrefix(host, "0x") {
		return lingtu.ErrInvalidTrialInput
	}
	if resolve {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		ips, err := net.DefaultResolver.LookupIPAddr(ctx, host)
		if err != nil || len(ips) == 0 {
			return errors.New("model endpoint unavailable")
		}
		for _, ip := range ips {
			if !publicModelIP(ip.IP) {
				return lingtu.ErrInvalidTrialInput
			}
		}
	}
	return nil
}
func modelIdentifier(value string) bool {
	return value != "" && len(value) <= 128 && !strings.ContainsAny(value, ",\r\n\t ?#\\")
}
func platformIdentifier(value string) bool {
	if value == "" || len(value) > 128 {
		return false
	}
	for _, r := range value {
		if !((r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '-' || r == '.' || r == '_') {
			return false
		}
	}
	return true
}
func validateModelCredential(p modelProvider, ch model.Channel) error {
	if len(ch.Key) > 16384 || strings.ContainsRune(ch.Key, '\x00') {
		return lingtu.ErrInvalidTrialInput
	}
	if p.Category == "selfhost" {
		if strings.ContainsAny(ch.Key, "\r\n") {
			return lingtu.ErrInvalidTrialInput
		}
		return nil
	}
	if strings.TrimSpace(ch.Key) == "" {
		return nil
	} // incomplete disabled drafts may be saved
	if p.Provider == "vertex" {
		var cred struct {
			Type        string `json:"type"`
			ProjectID   string `json:"project_id"`
			ClientEmail string `json:"client_email"`
			PrivateKey  string `json:"private_key"`
		}
		if json.Unmarshal([]byte(ch.Key), &cred) != nil || cred.Type != "service_account" || !modelIdentifier(cred.ProjectID) || !strings.Contains(cred.ClientEmail, "@") {
			return lingtu.ErrInvalidTrialInput
		}
		block, _ := pem.Decode([]byte(cred.PrivateKey))
		if block == nil {
			return lingtu.ErrInvalidTrialInput
		}
		if _, err := x509.ParsePKCS8PrivateKey(block.Bytes); err != nil {
			return lingtu.ErrInvalidTrialInput
		}
	} else if strings.ContainsAny(ch.Key, "\r\n") {
		return lingtu.ErrInvalidTrialInput
	}
	switch p.Provider {
	case "hunyuan", "spark":
		parts := strings.Split(ch.Key, "|")
		if len(parts) != 3 {
			return lingtu.ErrInvalidTrialInput
		}
		for _, v := range parts {
			if strings.TrimSpace(v) == "" {
				return lingtu.ErrInvalidTrialInput
			}
		}
		if p.Provider == "hunyuan" {
			if id, err := strconv.ParseInt(parts[0], 10, 64); err != nil || id <= 0 {
				return lingtu.ErrInvalidTrialInput
			}
		}
	case "bedrock":
		parts := strings.Split(ch.Key, "|")
		if len(parts) != 2 && len(parts) != 3 {
			return lingtu.ErrInvalidTrialInput
		}
		for _, v := range parts {
			if strings.TrimSpace(v) == "" {
				return lingtu.ErrInvalidTrialInput
			}
		}
		region := parts[len(parts)-1]
		if len(region) > 40 || !strings.Contains(region, "-") || !platformIdentifier(region) {
			return lingtu.ErrInvalidTrialInput
		}
	default:
		if strings.Contains(ch.Key, "|") {
			return lingtu.ErrInvalidTrialInput
		}
	}
	return nil
}
func validateConnection(p modelProvider, ch model.Channel, enabled bool) error {
	if !modelIdentifier(ch.Models) || strings.TrimSpace(ch.Models) != ch.Models || ch.Group != "default" || ch.ChannelInfo.IsMultiKey {
		return lingtu.ErrInvalidTrialInput
	}
	base := ""
	if ch.BaseURL != nil {
		base = *ch.BaseURL
	}
	if err := validateModelURL(p, base, false); err != nil {
		return err
	}
	if err := validateModelCredential(p, ch); err != nil {
		return err
	}
	if enabled && !credentialConfigured(p, ch) {
		return lingtu.ErrInvalidTrialInput
	}
	switch p.Provider {
	case "spark":
		switch ch.Models {
		case "SparkDesk-v1.1", "SparkDesk-v2.1", "SparkDesk-v3.1", "SparkDesk-v3.5", "SparkDesk-v4.0":
		default:
			return lingtu.ErrInvalidTrialInput
		}
	case "azure":
		if !platformIdentifier(ch.Other) {
			return lingtu.ErrInvalidTrialInput
		}
	case "vertex":
		if !platformIdentifier(ch.Other) {
			return lingtu.ErrInvalidTrialInput
		}
	case "cloudflare":
		if len(ch.Other) != 32 {
			return lingtu.ErrInvalidTrialInput
		}
		if _, err := hex.DecodeString(ch.Other); err != nil {
			return lingtu.ErrInvalidTrialInput
		}
	}
	return nil
}

func saveModelPolicy(tx *gorm.DB, selected string) error {
	policy, err := lingtu.LoadTrialPolicy(tx)
	if err != nil {
		return err
	}
	policy.DefaultModel = selected
	return persistTrialPolicy(tx, policy)
}

// Both administrator entry points share this transaction-bound selection gate.
// Legacy aliases retain their migration allowance; unchanged defaults can be
// retained while editing limits even when their channel is currently unavailable.
func persistTrialPolicy(tx *gorm.DB, policy lingtu.TrialPolicy) error {
	previous, err := lingtu.LoadTrialPolicy(tx)
	if err != nil {
		return err
	}
	if previous.DefaultModel != policy.DefaultModel && strings.HasPrefix(policy.DefaultModel, "managed-") {
		var row lingtu.ModelConnection
		var ch model.Channel
		if err := tx.First(&row, "model_id = ?", policy.DefaultModel).Error; err != nil {
			return err
		}
		if err := tx.First(&ch, row.ChannelID).Error; err != nil {
			return err
		}
		p, ok := managedProvider(row.Provider)
		if !ok || !row.Enabled || ch.Status != common.ChannelStatusEnabled || row.ConfigHash != channelHash(ch) || row.TestStatus != "success" || row.TestedHash != row.ConfigHash || !credentialConfigured(p, ch) {
			return errors.New("connection not tested and ready")
		}
	}
	raw, err := common.Marshal(policy)
	if err != nil {
		return err
	}
	return tx.Save(&lingtu.ManagedSetting{Name: "trial_policy", Value: string(raw)}).Error
}

func (h *Host) saveTrialConfiguration(r configurationRequest) error {
	return model.DB.Transaction(func(tx *gorm.DB) error {
		policy, err := lingtu.LoadTrialPolicy(tx)
		if err != nil {
			return err
		}
		policy.Calls = r.Calls
		policy.Days = r.Days
		policy.DailyCalls = r.DailyCalls
		policy.MaxTokens = r.MaxTokens
		policy.DefaultModel = r.Model
		if r.PerAccountConcurrent != nil {
			policy.PerAccountConcurrent = *r.PerAccountConcurrent
		}
		if r.RequestsPerMinute != nil {
			policy.RequestsPerMinute = *r.RequestsPerMinute
		}
		if r.GlobalConcurrent != nil {
			policy.GlobalConcurrent = *r.GlobalConcurrent
		}
		if policy.Calls < 0 || policy.Calls > 1000000 || policy.Days < 1 || policy.Days > 365 || policy.DailyCalls < 1 || policy.DailyCalls > 100000 || policy.MaxTokens < 1 || policy.MaxTokens > 8192 || policy.PerAccountConcurrent < 1 || policy.PerAccountConcurrent > 4 || policy.RequestsPerMinute < 1 || policy.RequestsPerMinute > 120 || policy.GlobalConcurrent < 1 || policy.GlobalConcurrent > 16 || !validManagedModelWithDB(tx, policy.DefaultModel) {
			return lingtu.ErrInvalidTrialInput
		}
		return persistTrialPolicy(tx, policy)
	})
}
func (h *Host) saveModelConnection(c *gin.Context, r configurationRequest) error {
	return h.executeModelConnection(c, r, controller.TestManagedChannel)
}

// A probe is an external boundary. Production always supplies the native adapter test.
// Tests supply a non-network probe to prove persistence and failure semantics.
func (h *Host) executeModelConnection(c *gin.Context, r configurationRequest, probe func(context.Context, *model.Channel, int) error) error {
	p, ok := managedProvider(r.Provider)
	if !ok || r.ConnectionID < 0 || r.Secret != "" && r.ClearSecret {
		return lingtu.ErrInvalidTrialInput
	}
	if r.Action != "save" && r.Action != "test" && r.Action != "delete" && r.Action != "select" {
		return lingtu.ErrInvalidTrialInput
	}
	if r.Action != "save" && (r.ConnectionID == 0 || r.Secret != "" || r.ClearSecret) {
		return lingtu.ErrInvalidTrialInput
	}
	if r.TestAfterSave && r.Action != "save" {
		return lingtu.ErrInvalidTrialInput
	}
	var row lingtu.ModelConnection
	var ch model.Channel
	err := model.DB.Transaction(func(tx *gorm.DB) error {
		if err := migrateLegacyModelConnections(tx); err != nil {
			return err
		}
		if r.ConnectionID > 0 {
			if err := tx.First(&row, "channel_id = ? AND provider = ?", r.ConnectionID, r.Provider).Error; err != nil {
				return err
			}
			if err := tx.First(&ch, r.ConnectionID).Error; err != nil {
				return err
			}
			if r.Revision > 0 && row.Revision != r.Revision {
				return errors.New("connection changed")
			}
		}
		if r.Action == "test" {
			return nil
		}
		if r.Action == "delete" {
			policy, err := lingtu.LoadTrialPolicy(tx)
			if err != nil {
				return err
			}
			if policy.DefaultModel == row.ModelID {
				return errors.New("selected connection cannot be deleted")
			}
			var count int64
			if err := tx.Model(&lingtu.ManagedAccount{}).Where("model = ?", row.ModelID).Count(&count).Error; err != nil {
				return err
			}
			if count > 0 {
				return errors.New("assigned connection cannot be deleted")
			}
			if err := tx.Where("channel_id = ?", ch.Id).Delete(&model.Ability{}).Error; err != nil {
				return err
			}
			if err := tx.Delete(&ch).Error; err != nil {
				return err
			}
			return tx.Delete(&row).Error
		}
		if r.Action == "select" {
			if !row.Enabled || ch.Status != common.ChannelStatusEnabled || row.ConfigHash != channelHash(ch) || row.TestStatus != "success" || row.TestedHash != row.ConfigHash || !credentialConfigured(p, ch) {
				return errors.New("connection not tested and ready")
			}
			return saveModelPolicy(tx, row.ModelID)
		}
		if len(strings.TrimSpace(r.Name)) == 0 || len(r.Name) > 128 || strings.ContainsAny(r.Name, "\r\n") {
			return lingtu.ErrInvalidTrialInput
		}
		if r.ClearSecret {
			ch.Key = ""
		} else if secret := strings.TrimSpace(r.Secret); secret != "" {
			ch.Key = secret
		}
		// Migrated legacy adapter/parameters remain intact on edits. New connections
		// always use their actual native provider adapter.
		if ch.Id == 0 {
			// Materialize the native database default before fingerprinting.
			autoBan := 1
			ch.AutoBan = &autoBan
			ch.Type = p.ChannelType
			ch.Group = "default"
			ch.CreatedTime = time.Now().Unix()
			ch.Name = "lingtu-managed-" + p.Provider
			ch.Status = common.ChannelStatusManuallyDisabled
		}
		base := strings.TrimRight(strings.TrimSpace(r.BaseURL), "/")
		ch.BaseURL = &base
		ch.Models = strings.TrimSpace(r.UpstreamModel)
		// This legacy alias is also the client's explicit image capability contract.
		if row.ModelID == visionModel && ch.Models != visionModel {
			return lingtu.ErrInvalidTrialInput
		}
		switch p.Provider {
		case "azure":
			ch.Other = strings.TrimSpace(r.APIVersion)
		case "vertex":
			ch.Other = strings.TrimSpace(r.Region)
		case "cloudflare":
			ch.Other = strings.TrimSpace(r.AccountID)
		}
		if err := validateConnection(p, ch, r.Enabled); err != nil {
			return err
		}
		hash := channelHash(ch)
		changed := row.ChannelID == 0 || hash != row.ConfigHash || row.Enabled != r.Enabled || row.Name != r.Name
		if changed {
			row.Revision++
			row.TestStatus = "never"
			row.TestedAt = 0
			row.TestedHash = ""
			ch.TestTime = 0
			ch.Status = common.ChannelStatusManuallyDisabled
		}
		if !r.Enabled {
			ch.Status = common.ChannelStatusManuallyDisabled
		}
		if err := tx.Save(&ch).Error; err != nil {
			return err
		}
		if err := ch.UpdateAbilities(tx); err != nil {
			return err
		}
		row.ChannelID = ch.Id
		row.Provider = p.Provider
		row.Name = r.Name
		row.Enabled = r.Enabled
		row.ConfigHash = hash
		if row.ModelID == "" {
			row.ModelID = "managed-" + strconv.Itoa(ch.Id)
		}
		if r.MakeDefault {
			return errors.New("save then test then explicitly select the connection")
		}
		return tx.Save(&row).Error
	})
	if err != nil {
		return err
	}
	if r.Action == "save" {
		if c != nil {
			c.Set("lingtu_connection_saved", true)
			c.Set("lingtu_saved_connection_id", row.ChannelID)
		}
		model.InitChannelCache()
		if r.TestAfterSave {
			// Reuse the saved-config path, with no credential/form fields, and bind
			// the probe to exactly the revision committed by this authorized save.
			return h.executeModelConnection(c, configurationRequest{Section: "model_connection", Action: "test", Provider: r.Provider, ConnectionID: row.ChannelID, Revision: row.Revision}, probe)
		}
		return nil
	}
	if r.Action == "test" {
		// Testing only persisted revision; unsaved form changes never masquerade as tested.
		if err := validateConnection(p, ch, true); err != nil {
			return err
		}
		if err := validateModelURL(p, ch.GetBaseURL(), true); err != nil {
			return err
		}
		ctx := context.Background()
		uid := 0
		if c != nil {
			ctx = c.Request.Context()
			uid = c.GetInt("id")
		}
		testedHash := channelHash(ch)
		probeErr := probe(ctx, &ch, uid)
		err = model.DB.Transaction(func(tx *gorm.DB) error {
			var current lingtu.ModelConnection
			var native model.Channel
			if err := tx.First(&current, row.ChannelID).Error; err != nil {
				return err
			}
			if err := tx.First(&native, row.ChannelID).Error; err != nil {
				return err
			}
			if current.Revision != row.Revision || channelHash(native) != testedHash || current.ConfigHash != testedHash {
				return errors.New("connection changed during test")
			}
			current.TestedHash = testedHash
			current.TestedAt = time.Now().Unix()
			current.TestStatus = "failed"
			native.Status = common.ChannelStatusManuallyDisabled
			native.TestTime = 0
			if probeErr == nil {
				current.TestStatus = "success"
				native.TestTime = current.TestedAt
				if current.Enabled {
					native.Status = common.ChannelStatusEnabled
				}
			}
			if err := tx.Save(&native).Error; err != nil {
				return err
			}
			if err := native.UpdateAbilities(tx); err != nil {
				return err
			}
			return tx.Save(&current).Error
		})
		if err != nil {
			return err
		}
		model.InitChannelCache()
		if probeErr != nil {
			return errors.New("model connection test failed")
		}
		return nil
	}
	model.InitChannelCache()
	return nil
}

func validManagedModel(selected string) bool {
	return validManagedModelWithDB(model.DB, selected)
}
func validManagedModelWithDB(db *gorm.DB, selected string) bool {
	if selected == "deepseek-flash" || selected == "qwen-plus" || selected == visionModel {
		return true
	}
	var count int64
	return db.Model(&lingtu.ModelConnection{}).Where("model_id = ?", selected).Count(&count).Error == nil && count == 1
}
