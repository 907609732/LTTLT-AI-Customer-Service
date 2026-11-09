package lingtu

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"strings"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// These tombstones deliberately have no user foreign key: deleting or unbinding
// an account must never make an already claimed identity eligible again.
type TrialIdentityClaim struct {
	IdentityHash string `gorm:"type:varchar(64);primaryKey"`
	UserID       int    `gorm:"not null;index"`
	CreatedAt    int64  `gorm:"autoCreateTime:false;not null"`
}

func (TrialIdentityClaim) TableName() string { return "lingtu_trial_identity_claims" }

// Only explicit native verification boundaries may write this evidence. A
// generic OAuth email/profile field is not evidence of email ownership.
// Trusted verification claims the identity before the first grant, so a native
// outer transaction with an older MySQL snapshot cannot miss a concurrent grant
// and lose a just-bound identity on immediate unlink.
type TrialVerifiedEmail struct {
	UserID       int    `gorm:"primaryKey;autoIncrement:false"`
	IdentityHash string `gorm:"type:varchar(64);primaryKey"`
	CreatedAt    int64  `gorm:"autoCreateTime:false;not null"`
}

func (TrialVerifiedEmail) TableName() string { return "lingtu_trial_verified_emails" }

type identityUser struct {
	ID    int `gorm:"primaryKey;autoIncrement:false"`
	Email string
}

func (identityUser) TableName() string { return "users" }

type identityProvider struct {
	ID   int `gorm:"primaryKey;autoIncrement:false"`
	Slug string
}

func (identityProvider) TableName() string { return "custom_oauth_providers" }

type identityBinding struct {
	UserID         int
	ProviderID     int
	ProviderUserID string
}

func (identityBinding) TableName() string { return "user_oauth_bindings" }

func trialIdentityHash(kind, scope, subject string) string {
	digest := sha256.Sum256([]byte("lingtu/trial-identity/v1\x00" + kind + "\x00" + scope + "\x00" + subject))
	return hex.EncodeToString(digest[:])
}
func claimTrialIdentity(tx *gorm.DB, uid int, hash string, now time.Time) (bool, error) {
	claim := TrialIdentityClaim{IdentityHash: hash, UserID: uid, CreatedAt: now.Unix()}
	if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&claim).Error; err != nil {
		return false, err
	}
	current := tx.Where("identity_hash = ?", hash)
	// Native binding transactions may have an older MySQL snapshot. A locking
	// read sees the committed owner; SQLite is already serialized by its write
	// gate and deliberately receives no unsupported FOR UPDATE clause.
	if dialect := tx.Dialector.Name(); dialect == "mysql" || dialect == "postgres" {
		current = current.Clauses(clause.Locking{Strength: "UPDATE"})
	}
	if err := current.First(&claim).Error; err != nil {
		return false, err
	}
	return claim.UserID == uid, nil
}

// RecordVerifiedTrialEmail is called only after a server-verified registration
// code or CompleteEmailBinding. It never grants, merges or transfers ownership.
// Call it inside the native verification transaction whenever one is available.
func RecordVerifiedTrialEmail(db *gorm.DB, uid int, email string, now time.Time) error {
	email = strings.ToLower(strings.TrimSpace(email))
	if uid <= 0 || email == "" || len(email) > 320 || !strings.Contains(email, "@") {
		return ErrInvalidTrialInput
	}
	hash := trialIdentityHash("email", "", email)
	return NewTrialStore(db).transaction(func(tx *gorm.DB) error {
		if err := lockTrialLimits(tx); err != nil {
			return err
		}
		proof := TrialVerifiedEmail{UserID: uid, IdentityHash: hash, CreatedAt: now.Unix()}
		if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&proof).Error; err != nil {
			return err
		}
		_, err := claimTrialIdentity(tx, uid, hash, now)
		return err
	})
}

// RecordTrialOAuthIdentity runs when a native custom-provider binding is
// created/replaced, before commit. Managed ProviderUserID is already scoped to
// the verified application/subject. Its bytes remain opaque and case-sensitive.
func RecordTrialOAuthIdentity(db *gorm.DB, uid, providerID int, subject string, now time.Time) error {
	if uid <= 0 || providerID <= 0 || subject == "" || len(subject) > 256 {
		return ErrInvalidTrialInput
	}
	return NewTrialStore(db).transaction(func(tx *gorm.DB) error {
		if err := lockTrialLimits(tx); err != nil {
			return err
		}
		var provider identityProvider
		if err := tx.Select("id", "slug").First(&provider, providerID).Error; err != nil {
			return err
		}
		if provider.Slug != "ltwechat" && provider.Slug != "ltdingtalk" {
			return nil
		}
		_, err := claimTrialIdentity(tx, uid, trialIdentityHash("oauth", provider.Slug, subject), now)
		return err
	})
}

// Must run after the durable write gate is acquired and before grant creation.
// No missing-table/column fallback is allowed on the production identity path.
func claimCurrentTrialIdentities(tx *gorm.DB, uid int, now time.Time) (bool, error) {
	var user identityUser
	if err := tx.Select("id", "email").First(&user, uid).Error; err != nil {
		return false, err
	}
	hashes := []string{}
	if email := strings.ToLower(strings.TrimSpace(user.Email)); email != "" {
		hash := trialIdentityHash("email", "", email)
		var proof TrialVerifiedEmail
		err := tx.Where("user_id = ? AND identity_hash = ?", uid, hash).First(&proof).Error
		if err == nil {
			hashes = append(hashes, hash)
		} else if !errors.Is(err, gorm.ErrRecordNotFound) {
			return false, err
		}
	}
	var bindings []struct {
		Slug           string
		ProviderUserID string
	}
	err := tx.Table("user_oauth_bindings AS binding").Select("provider.slug, binding.provider_user_id").Joins("JOIN custom_oauth_providers AS provider ON provider.id = binding.provider_id").Where("binding.user_id = ? AND provider.slug IN ?", uid, []string{"ltwechat", "ltdingtalk"}).Scan(&bindings).Error
	if err != nil {
		return false, err
	}
	for _, binding := range bindings {
		if binding.ProviderUserID != "" {
			hashes = append(hashes, trialIdentityHash("oauth", binding.Slug, binding.ProviderUserID))
		}
	}
	eligible := len(hashes) > 0
	for _, hash := range hashes {
		owned, err := claimTrialIdentity(tx, uid, hash, now)
		if err != nil {
			return false, err
		}
		eligible = eligible && owned
	}
	return eligible, nil
}
