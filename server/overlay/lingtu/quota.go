package lingtu

import (
	"errors"
	"gorm.io/gorm"
	"time"
)

// Paid and trial counters remain separate; recharge may extend an active trial's expiry.
type PaidGrant struct {
	Epoch     int64 `gorm:"not null;default:0"`
	UserID    int   `gorm:"primaryKey;autoIncrement:false"`
	Limit     int   `gorm:"column:call_limit;not null"`
	Used      int   `gorm:"not null"`
	Reserved  int   `gorm:"not null"`
	ExpiresAt int64 `gorm:"not null"`
}

func (PaidGrant) TableName() string { return "lingtu_paid_grants" }

type QuotaPool struct {
	Limit      int    `json:"limit"`
	Used       int    `json:"used"`
	Reserved   int    `json:"reserved"`
	Remaining  int    `json:"remaining"`
	ExpiresAt  int64  `json:"expires_at"`
	Provenance string `json:"provenance,omitempty"`
}
type QuotaSnapshot struct {
	Trial     QuotaPool `json:"trial"`
	Paid      QuotaPool `json:"paid"`
	Remaining int       `json:"remaining"`
}

func (s *BillingStore) Quota(uid int, now time.Time) (QuotaSnapshot, error) {
	if uid <= 0 {
		return QuotaSnapshot{}, ErrBillingInput
	}
	var q QuotaSnapshot
	err := NewTrialStore(s.db).transaction(func(tx *gorm.DB) error {
		if err := lockTrialLimits(tx); err != nil {
			return err
		}
		var t TrialGrant
		var p PaidGrant
		if err := tx.First(&t, "user_id = ?", uid).Error; err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		if err := tx.First(&p, "user_id = ?", uid).Error; err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		q.Trial = quotaPool(t.Limit, t.Used, t.Reserved, t.ExpiresAt, now)
		q.Trial.Provenance = t.Provenance
		q.Paid = quotaPool(p.Limit, p.Used, p.Reserved, p.ExpiresAt, now)
		q.Remaining = q.Trial.Remaining + q.Paid.Remaining
		return nil
	})
	return q, err
}
func quotaPool(limit, used, reserved int, expiry int64, now time.Time) QuotaPool {
	q := QuotaPool{Limit: limit, Used: used, Reserved: reserved, ExpiresAt: expiry}
	if expiry > now.Unix() {
		q.Remaining = max(0, limit-used-reserved)
	}
	return q
}

// Caller holds the durable limit gate. Trial is consumed first to respect its shorter expiry.
func reserveQuota(tx *gorm.DB, uid int, id, digest string, now time.Time) error {
	source := "trial"
	result := tx.Model(&TrialGrant{}).Where("user_id = ? AND expires_at > ? AND used + reserved < call_limit", uid, now.Unix()).UpdateColumn("reserved", gorm.Expr("reserved + 1"))
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		source = "paid"
		result = tx.Model(&PaidGrant{}).Where("user_id = ? AND expires_at > ? AND used + reserved < call_limit", uid, now.Unix()).UpdateColumn("reserved", gorm.Expr("reserved + 1"))
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrTrialUnavailable
		}
	}
	epoch := int64(0)
	if source == "paid" {
		var paid PaidGrant
		if err := tx.First(&paid, "user_id = ?", uid).Error; err != nil {
			return err
		}
		epoch = paid.Epoch
	}
	return tx.Create(&TrialRequest{PoolEpoch: epoch, UserID: uid, RequestID: id, Digest: digest, State: "pending", Source: source, CreatedAt: now.Unix()}).Error
}
