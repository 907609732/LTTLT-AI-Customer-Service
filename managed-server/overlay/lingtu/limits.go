package lingtu

import (
	"errors"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"time"
)

var (
	ErrAccountConcurrency = errors.New("account trial concurrency limit reached")
	ErrGlobalConcurrency  = errors.New("global trial concurrency limit reached")
	ErrTrialRateLimit     = errors.New("account trial rate limit reached")
	ErrDailyCallLimit     = errors.New("daily trial call limit reached")
)

type TrialLimits struct {
	PerAccountConcurrent int
	RequestsPerMinute    int
	GlobalConcurrent     int
	DailyCalls           int
}

// A single durable write gate serializes limit checks on every supported SQL engine.
// No process-local mutex or dialect-specific SELECT FOR UPDATE is required.
type trialLimitGate struct {
	ID      int   `gorm:"primaryKey;autoIncrement:false"`
	Version int64 `gorm:"not null"`
}

func (trialLimitGate) TableName() string { return "lingtu_trial_limit_gate" }

type trialDailyBudget struct {
	Day   string `gorm:"type:varchar(10);primaryKey"`
	Calls int    `gorm:"not null"`
}

func (trialDailyBudget) TableName() string { return "lingtu_trial_daily_budgets" }

type trialLimitedRequest struct {
	UserID    int    `gorm:"primaryKey;autoIncrement:false"`
	RequestID string `gorm:"type:varchar(128);primaryKey"`
	Day       string `gorm:"type:varchar(10);not null"`
	StartedAt int64  `gorm:"not null;index"`
	Slot      bool   `gorm:"not null;index"`
}

func (trialLimitedRequest) TableName() string { return "lingtu_trial_limited_requests" }

func lockTrialLimits(tx *gorm.DB) error {
	return tx.Model(&trialLimitGate{}).Where("id = ?", 1).UpdateColumn("version", gorm.Expr("version + 1")).Error
}

func (s *TrialStore) ReserveWithLimits(userID int, requestID, digest string, now time.Time, limits TrialLimits) (Reservation, error) {
	if userID <= 0 || len(requestID) < 1 || len(requestID) > 128 || len(digest) < 1 || len(digest) > 128 || limits.PerAccountConcurrent < 1 || limits.RequestsPerMinute < 1 || limits.GlobalConcurrent < 1 || limits.DailyCalls < 1 {
		return Reservation{}, ErrInvalidTrialInput
	}
	var reservation Reservation
	err := s.transaction(func(tx *gorm.DB) error {
		if err := lockTrialLimits(tx); err != nil {
			return err
		}
		scoped := NewTrialStore(tx)
		if r, err := scoped.existing(userID, requestID, digest); !errors.Is(err, gorm.ErrRecordNotFound) {
			reservation = r
			return err
		}
		var count int64
		if err := tx.Model(&trialLimitedRequest{}).Where("user_id = ? AND slot = ?", userID, true).Count(&count).Error; err != nil {
			return err
		}
		if count >= int64(limits.PerAccountConcurrent) {
			return ErrAccountConcurrency
		}
		if err := tx.Model(&trialLimitedRequest{}).Where("slot = ?", true).Count(&count).Error; err != nil {
			return err
		}
		if count >= int64(limits.GlobalConcurrent) {
			return ErrGlobalConcurrency
		}
		// Sliding sixty-second window includes failed upstream starts, excludes retries.
		if err := tx.Model(&trialLimitedRequest{}).Where("user_id = ? AND started_at > ?", userID, now.Add(-time.Minute).UnixNano()).Count(&count).Error; err != nil {
			return err
		}
		if count >= int64(limits.RequestsPerMinute) {
			return ErrTrialRateLimit
		}
		day := now.UTC().Format("2006-01-02")
		budget := trialDailyBudget{Day: day}
		if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&budget).Error; err != nil {
			return err
		}
		result := tx.Model(&trialDailyBudget{}).Where("day = ? AND calls < ?", day, limits.DailyCalls).UpdateColumn("calls", gorm.Expr("calls + 1"))
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrDailyCallLimit
		}
		result = tx.Model(&TrialGrant{}).Where("user_id = ? AND expires_at > ? AND used + reserved < call_limit", userID, now.Unix()).UpdateColumn("reserved", gorm.Expr("reserved + 1"))
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrTrialUnavailable
		}
		if err := tx.Create(&TrialRequest{UserID: userID, RequestID: requestID, Digest: digest, State: "pending", CreatedAt: now.Unix()}).Error; err != nil {
			return err
		}
		if err := tx.Create(&trialLimitedRequest{UserID: userID, RequestID: requestID, Day: day, StartedAt: now.UnixNano(), Slot: true}).Error; err != nil {
			return err
		}
		reservation = Reservation{Created: true, State: "pending"}
		return nil
	})
	if err != nil {
		if r, readErr := s.existing(userID, requestID, digest); !errors.Is(readErr, gorm.ErrRecordNotFound) {
			return r, readErr
		}
		return Reservation{}, err
	}
	return reservation, nil
}

// Called only after a successful state transition, inside the same transaction.
func settleTrialLimits(tx *gorm.DB, userID int, requestID, outcome string) error {
	var limited trialLimitedRequest
	err := tx.Where("user_id = ? AND request_id = ?", userID, requestID).First(&limited).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil
	}
	if err != nil {
		return err
	}
	if limited.Slot {
		if err = tx.Model(&trialLimitedRequest{}).Where("user_id = ? AND request_id = ?", userID, requestID).UpdateColumn("slot", false).Error; err != nil {
			return err
		}
	}
	if outcome == "failed" {
		result := tx.Model(&trialDailyBudget{}).Where("day = ? AND calls > 0", limited.Day).UpdateColumn("calls", gorm.Expr("calls - 1"))
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrSettlementConflict
		}
	}
	return nil
}

// RecoverPending runs before the single-process HTTP listener starts. A lost
// response is never replayed; uncertain reservations require reconciliation.
func (s *TrialStore) RecoverPending() error {
	return s.transaction(func(tx *gorm.DB) error {
		if err := lockTrialLimits(tx); err != nil {
			return err
		}
		var pending []trialLimitedRequest
		if err := tx.Where("slot = ?", true).Find(&pending).Error; err != nil {
			return err
		}
		for _, r := range pending {
			if err := tx.Model(&TrialRequest{}).Where("user_id = ? AND request_id = ? AND state = ?", r.UserID, r.RequestID, "pending").UpdateColumn("state", "uncertain").Error; err != nil {
				return err
			}
			if err := tx.Model(&trialLimitedRequest{}).Where("user_id = ? AND request_id = ?", r.UserID, r.RequestID).UpdateColumn("slot", false).Error; err != nil {
				return err
			}
		}
		return nil
	})
}
