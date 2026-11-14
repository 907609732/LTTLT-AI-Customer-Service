package lingtu

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"reflect"
	"regexp"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var ErrBillingConflict = errors.New("billing order conflicts with payment or retry")
var ErrBillingInput = errors.New("invalid billing input")
var billingIdentifier = regexp.MustCompile(`^[a-zA-Z0-9_-]{1,128}$`)

// Monetary amounts are integer minor currency units, never floating point.
type BillingPlan struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Currency  string `json:"currency"`
	Amount    int64  `json:"amount"`
	Calls     int    `json:"calls"`
	ValidDays int    `json:"valid_days"`
}

func (p BillingPlan) Valid() bool {
	return billingIdentifier.MatchString(p.ID) && len(p.Name) > 0 && len(p.Name) <= 128 && p.Currency == "cny" && p.Amount > 0 && p.Amount <= 100000000 && p.Calls > 0 && p.Calls <= 1000000 && p.ValidDays > 0 && p.ValidDays <= 365
}

type BillingOrder struct {
	ID        string      `json:"id" gorm:"type:varchar(64);primaryKey"`
	UserID    int         `json:"-" gorm:"not null;uniqueIndex:lingtu_billing_request,priority:1"`
	RequestID string      `json:"-" gorm:"type:varchar(128);not null;uniqueIndex:lingtu_billing_request,priority:2"`
	Plan      BillingPlan `json:"plan" gorm:"embedded;embeddedPrefix:plan_"`
	State     string      `json:"state" gorm:"type:varchar(16);not null"`
	SessionID *string     `json:"-" gorm:"type:varchar(255);uniqueIndex"`
	CreatedAt int64       `json:"created_at" gorm:"autoCreateTime:false"`
	PaidAt    int64       `json:"paid_at"`
}

func (BillingOrder) TableName() string { return "lingtu_billing_orders" }

// One immutable credit per order; it commits atomically with the actual call grant.
type BillingCredit struct {
	OrderID   string `gorm:"type:varchar(64);primaryKey"`
	EventID   string `gorm:"type:varchar(255);not null;uniqueIndex"`
	UserID    int    `gorm:"not null;index"`
	Calls     int    `gorm:"not null"`
	CreatedAt int64  `gorm:"autoCreateTime:false"`
}

func (BillingCredit) TableName() string { return "lingtu_billing_credits" }

type BillingPayment struct {
	OrderID, SessionID, EventID, Currency string
	Amount                                int64
}
type BillingStore struct{ db *gorm.DB }

func NewBillingStore(db *gorm.DB) *BillingStore { return &BillingStore{db: db} }
func (s *BillingStore) Migrate() error          { return s.db.AutoMigrate(&BillingOrder{}, &BillingCredit{}) }

func (s *BillingStore) CreateOrder(uid int, request string, plan BillingPlan, now time.Time) (BillingOrder, error) {
	if uid <= 0 || !billingIdentifier.MatchString(request) || !plan.Valid() {
		return BillingOrder{}, ErrBillingInput
	}
	var existing BillingOrder
	lookup := func() (BillingOrder, error) {
		err := s.db.Where("user_id = ? AND request_id = ?", uid, request).First(&existing).Error
		if err == nil && !reflect.DeepEqual(existing.Plan, plan) {
			err = ErrBillingConflict
		}
		return existing, err
	}
	if o, err := lookup(); !errors.Is(err, gorm.ErrRecordNotFound) {
		return o, err
	}
	var random [24]byte
	if _, err := rand.Read(random[:]); err != nil {
		return BillingOrder{}, err
	}
	order := BillingOrder{ID: hex.EncodeToString(random[:]), UserID: uid, RequestID: request, Plan: plan, State: "pending", CreatedAt: now.Unix()}
	if err := s.db.Create(&order).Error; err != nil {
		if o, readErr := lookup(); readErr == nil {
			return o, nil
		}
		return BillingOrder{}, err
	}
	return order, nil
}
func (s *BillingStore) AttachCheckout(orderID, session string) error {
	if len(session) == 0 || len(session) > 255 {
		return ErrBillingInput
	}
	result := s.db.Model(&BillingOrder{}).Where("id = ? AND state = ? AND (session_id IS NULL OR session_id = ?)", orderID, "pending", session).UpdateColumn("session_id", session)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return ErrBillingConflict
	}
	return nil
}
func (s *BillingStore) Orders(uid, offset, limit int) ([]BillingOrder, error) {
	if uid <= 0 || offset < 0 || offset > 100000 || limit < 1 || limit > 100 {
		return nil, ErrBillingInput
	}
	rows := []BillingOrder{}
	err := s.db.Where("user_id = ?", uid).Order("created_at DESC, id DESC").Offset(offset).Limit(limit).Find(&rows).Error
	return rows, err
}

// Credit is called only after provider signature and paid-session verification.
// Client redirects and client-provided outcome fields must never call this method.
func (s *BillingStore) Credit(payment BillingPayment, now time.Time) error {
	if payment.EventID == "" || len(payment.EventID) > 255 || payment.SessionID == "" {
		return ErrBillingInput
	}
	return NewTrialStore(s.db).transaction(func(tx *gorm.DB) error {
		if err := lockTrialLimits(tx); err != nil {
			return err
		}
		var order BillingOrder
		if err := tx.First(&order, "id = ?", payment.OrderID).Error; err != nil {
			return err
		}
		if order.SessionID == nil || *order.SessionID != payment.SessionID || order.Plan.Amount != payment.Amount || order.Plan.Currency != payment.Currency {
			return ErrBillingConflict
		}
		if order.State == "paid" {
			return nil
		}
		if order.State != "pending" {
			return ErrBillingConflict
		}
		var grant TrialGrant
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&grant, "user_id = ?", order.UserID).Error; err != nil {
			return err
		}
		limit := grant.Limit
		// Expired unused trial/purchased calls do not become spendable after a recharge.
		// Keep used/reserved counters so in-flight settlements retain their invariants.
		if grant.ExpiresAt <= now.Unix() {
			limit = grant.Used + grant.Reserved
		}
		if limit > 2000000000-order.Plan.Calls {
			return ErrBillingConflict
		}
		expiry := max(grant.ExpiresAt, now.Add(time.Duration(order.Plan.ValidDays)*24*time.Hour).Unix())
		if err := tx.Model(&TrialGrant{}).Where("user_id = ?", order.UserID).Updates(map[string]interface{}{"call_limit": limit + order.Plan.Calls, "expires_at": expiry}).Error; err != nil {
			return err
		}
		if err := tx.Create(&BillingCredit{OrderID: order.ID, EventID: payment.EventID, UserID: order.UserID, Calls: order.Plan.Calls, CreatedAt: now.Unix()}).Error; err != nil {
			return err
		}
		return tx.Model(&BillingOrder{}).Where("id = ?", order.ID).Updates(map[string]interface{}{"state": "paid", "paid_at": now.Unix()}).Error
	})
}
