package lingtu

import (
	"errors"
	"strings"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var (
	ErrTrialUnavailable   = errors.New("trial unavailable")
	ErrRequestConflict    = errors.New("request id already used for different input")
	ErrSettlementConflict = errors.New("request outcome already finalized")
	ErrInvalidTrialInput  = errors.New("invalid trial input")
)

type TrialGrant struct {
	UserID    int   `gorm:"primaryKey;autoIncrement:false"`
	Limit     int   `gorm:"column:call_limit;not null"`
	Used      int   `gorm:"not null"`
	Reserved  int   `gorm:"not null"`
	CreatedAt int64 `gorm:"autoCreateTime:false;not null"`
	ExpiresAt int64 `gorm:"not null"`
}

func (TrialGrant) TableName() string { return "lingtu_trial_grants" }

type TrialRequest struct {
	ID        uint64 `gorm:"primaryKey"`
	UserID    int    `gorm:"not null;uniqueIndex:lingtu_request_identity,priority:1"`
	RequestID string `gorm:"type:varchar(128);not null;uniqueIndex:lingtu_request_identity,priority:2"`
	Digest    string `gorm:"type:varchar(128);not null"`
	State     string `gorm:"type:varchar(16);not null"`
	CreatedAt int64  `gorm:"autoCreateTime:false;not null"`
}

func (TrialRequest) TableName() string { return "lingtu_trial_requests" }

type Reservation struct {
	Created bool
	State   string
}
type TrialStore struct{ db *gorm.DB }

func NewTrialStore(db *gorm.DB) *TrialStore { return &TrialStore{db: db} }
func (s *TrialStore) Migrate() error {
	if err := s.db.AutoMigrate(&TrialGrant{}, &TrialRequest{}, &trialLimitGate{}, &trialDailyBudget{}, &trialLimitedRequest{}); err != nil {
		return err
	}
	return s.db.Clauses(clause.OnConflict{DoNothing: true}).Create(&trialLimitGate{ID: 1}).Error
}

// Grant deliberately leaves an existing grant unchanged on login, retry or restart.
func (s *TrialStore) Grant(userID int, now time.Time, limit int, duration time.Duration) error {
	if userID <= 0 || limit <= 0 || limit > 1000000 || duration < time.Second || duration > 365*24*time.Hour {
		return ErrInvalidTrialInput
	}
	g := TrialGrant{UserID: userID, Limit: limit, CreatedAt: now.Unix(), ExpiresAt: now.Add(duration).Unix()}
	return s.db.Clauses(clause.OnConflict{DoNothing: true}).Create(&g).Error
}

func (s *TrialStore) existing(userID int, requestID, digest string) (Reservation, error) {
	var r TrialRequest
	err := s.db.Where("user_id = ? AND request_id = ?", userID, requestID).First(&r).Error
	if err != nil {
		return Reservation{}, err
	}
	if r.Digest != digest {
		return Reservation{}, ErrRequestConflict
	}
	return Reservation{State: r.State}, nil
}

func (s *TrialStore) Reserve(userID int, requestID, digest string, now time.Time) (Reservation, error) {
	if userID <= 0 || len(requestID) < 1 || len(requestID) > 128 || len(digest) < 1 || len(digest) > 128 {
		return Reservation{}, ErrInvalidTrialInput
	}
	if r, err := s.existing(userID, requestID, digest); !errors.Is(err, gorm.ErrRecordNotFound) {
		return r, err
	}
	err := s.transaction(func(tx *gorm.DB) error {
		result := tx.Model(&TrialGrant{}).Where("user_id = ? AND expires_at > ? AND used + reserved < call_limit", userID, now.Unix()).UpdateColumn("reserved", gorm.Expr("reserved + 1"))
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrTrialUnavailable
		}
		return tx.Create(&TrialRequest{UserID: userID, RequestID: requestID, Digest: digest, State: "pending", CreatedAt: now.Unix()}).Error
	})
	if err != nil {
		// A concurrent duplicate may have committed while this transaction was waiting.
		// Read outside the failed transaction (PostgreSQL aborts it after uniqueness errors).
		if r, readErr := s.existing(userID, requestID, digest); !errors.Is(readErr, gorm.ErrRecordNotFound) {
			return r, readErr
		}
		return Reservation{}, err
	}
	return Reservation{Created: true, State: "pending"}, nil
}

// Settle is an internal service operation, never exposed as a client-controlled outcome.
// Uncertain results retain their reservation until explicit reconciliation.
func (s *TrialStore) Settle(userID int, requestID, outcome string) error {
	if userID <= 0 || requestID == "" || (outcome != "success" && outcome != "failed" && outcome != "uncertain") {
		return ErrInvalidTrialInput
	}
	return s.transaction(func(tx *gorm.DB) error {
		if err := lockTrialLimits(tx); err != nil {
			return err
		}
		allowed := []string{"pending", "uncertain"}
		if outcome == "uncertain" {
			allowed = []string{"pending"}
		}
		result := tx.Model(&TrialRequest{}).Where("user_id = ? AND request_id = ? AND state IN ?", userID, requestID, allowed).UpdateColumn("state", outcome)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			var current TrialRequest
			if err := tx.Where("user_id = ? AND request_id = ?", userID, requestID).First(&current).Error; err != nil {
				return err
			}
			if current.State == outcome {
				return nil
			}
			return ErrSettlementConflict
		}
		if err := settleTrialLimits(tx, userID, requestID, outcome); err != nil {
			return err
		}
		if outcome == "uncertain" {
			return nil
		}
		updates := map[string]any{"reserved": gorm.Expr("reserved - 1")}
		if outcome == "success" {
			updates["used"] = gorm.Expr("used + 1")
		}
		result = tx.Model(&TrialGrant{}).Where("user_id = ? AND reserved > 0", userID).Updates(updates)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrSettlementConflict
		}
		return nil
	})
}

func (s *TrialStore) transaction(fn func(*gorm.DB) error) error {
	var err error
	for attempt := range 6 {
		err = s.db.Transaction(fn)
		if err == nil {
			return nil
		}
		message := strings.ToLower(err.Error())
		// These errors abort/roll back the transaction; replaying it cannot double reserve.
		if !strings.Contains(message, "database is locked") && !strings.Contains(message, "sqlite_busy") && !strings.Contains(message, "deadlock") && !strings.Contains(message, "serialization failure") {
			return err
		}
		time.Sleep(time.Duration(1<<attempt) * 5 * time.Millisecond)
	}
	return err
}
