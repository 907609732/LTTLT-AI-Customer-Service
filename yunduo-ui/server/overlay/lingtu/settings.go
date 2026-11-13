package lingtu

import (
	"encoding/base64"
	"errors"
	"os"
	"runtime"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type ManagedSetting struct {
	Name  string `gorm:"type:varchar(64);primaryKey"`
	Value string `gorm:"type:text;serializer:lingtu_secret"`
}

func (ManagedSetting) TableName() string { return "lingtu_settings" }

type ManagedAccount struct {
	UserID int    `gorm:"primaryKey;autoIncrement:false"`
	Status string `gorm:"type:varchar(16);not null"`
	Model  string `gorm:"type:varchar(128)"`
}

func (ManagedAccount) TableName() string { return "lingtu_accounts" }

type ManagedAudit struct {
	ID        uint64 `gorm:"primaryKey" json:"id"`
	ActorID   int    `json:"actor_id"`
	TargetID  int    `json:"target_id"`
	Section   string `gorm:"type:varchar(32)" json:"section"`
	Outcome   string `gorm:"type:varchar(32)" json:"outcome"`
	Reason    string `gorm:"type:varchar(256)" json:"reason"`
	CreatedAt int64  `gorm:"autoCreateTime:false;index" json:"created_at"`
}

func (ManagedAudit) TableName() string { return "lingtu_audits" }

type TrialPolicy struct {
	Calls                int    `json:"calls"`
	Days                 int    `json:"days"`
	DefaultModel         string `json:"default_model"`
	DailyCalls           int    `json:"daily_calls"`
	MaxTokens            int    `json:"max_tokens"`
	PerAccountConcurrent int    `json:"per_account_concurrent"`
	RequestsPerMinute    int    `json:"requests_per_minute"`
	GlobalConcurrent     int    `json:"global_concurrent"`
}

func DefaultTrialPolicy() TrialPolicy {
	return TrialPolicy{Calls: 20, Days: 7, DefaultModel: "deepseek-flash", DailyCalls: 200, MaxTokens: 512, PerAccountConcurrent: 1, RequestsPerMinute: 5, GlobalConcurrent: 4}
}
func LoadTrialPolicy(db *gorm.DB) (TrialPolicy, error) {
	policy := DefaultTrialPolicy()
	var row ManagedSetting
	err := db.First(&row, "name = ?", "trial_policy").Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return policy, nil
	}
	if err != nil {
		return policy, err
	}
	if common.UnmarshalJsonStr(row.Value, &policy) != nil || policy.Calls < 0 || policy.Calls > 1000000 || policy.Days < 1 || policy.Days > 365 || policy.DailyCalls < 1 || policy.MaxTokens < 1 || policy.MaxTokens > 8192 || policy.PerAccountConcurrent < 1 || policy.PerAccountConcurrent > 4 || policy.RequestsPerMinute < 1 || policy.RequestsPerMinute > 120 || policy.GlobalConcurrent < 1 || policy.GlobalConcurrent > 16 {
		return policy, errors.New("invalid managed trial policy")
	}
	return policy, nil
}
func EnsureManagedAccount(db *gorm.DB, userID int, now time.Time) error {
	if userID <= 0 {
		return ErrInvalidTrialInput
	}
	return NewTrialStore(db).transaction(func(tx *gorm.DB) error {
		if err := lockTrialLimits(tx); err != nil {
			return err
		}
		eligible, err := claimCurrentTrialIdentities(tx, userID, now)
		if err != nil {
			return err
		}
		account := ManagedAccount{UserID: userID, Status: "enabled"}
		if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&account).Error; err != nil {
			return err
		}
		policy, err := LoadTrialPolicy(tx)
		if err != nil {
			return err
		}
		if policy.Calls == 0 || !eligible {
			grant := TrialGrant{UserID: userID, CreatedAt: now.Unix(), ExpiresAt: now.Add(time.Duration(policy.Days) * 24 * time.Hour).Unix()}
			return tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&grant).Error
		}
		return NewTrialStore(tx).Grant(userID, now, policy.Calls, time.Duration(policy.Days)*24*time.Hour)
	})
}

func ConfigureEncryptionFromEnvironment() error {
	if len(os.Getenv("SESSION_SECRET")) < 32 {
		return errors.New("managed service requires a persistent SESSION_SECRET of at least 32 characters")
	}
	filename := os.Getenv("LINGTU_MASTER_KEY_FILE")
	if filename == "" {
		return errors.New("LINGTU_MASTER_KEY_FILE is required")
	}
	info, err := os.Stat(filename)
	if err != nil || !info.Mode().IsRegular() {
		return errors.New("managed master key file unavailable")
	}
	if runtime.GOOS != "windows" && info.Mode().Perm()&0077 != 0 {
		return errors.New("managed master key file must not be accessible by group or others")
	}
	raw, err := os.ReadFile(filename)
	if err != nil {
		return errors.New("managed master key file unavailable")
	}
	if len(raw) != 32 {
		raw, err = base64.StdEncoding.DecodeString(strings.TrimSpace(string(raw)))
		if err != nil {
			return errors.New("invalid managed master key encoding")
		}
	}
	vault, err := NewVault(raw)
	if err != nil {
		return err
	}
	SetEncryptionVault(vault)
	return nil
}
func RuntimeVault() (*Vault, error) {
	vault := encryptionVault.Load()
	if vault == nil {
		return nil, errors.New("managed credential encryption unavailable")
	}
	return vault, nil
}
func MigrateManaged(db *gorm.DB) error {
	if err := db.AutoMigrate(&ManagedSetting{}, &ManagedAccount{}, &ManagedAudit{}, &TrialIdentityClaim{}, &TrialVerifiedEmail{}, &ModelConnection{}); err != nil {
		return err
	}
	return NewTrialStore(db).Migrate()
}
