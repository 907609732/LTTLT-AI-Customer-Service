package lingtu

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"regexp"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var ErrBillingConflict = errors.New("billing order conflicts with payment or retry")
var ErrBillingInput = errors.New("invalid billing input")

const PermanentSupportPlanID = "support_100000"

var billingIdentifier = regexp.MustCompile(`^[a-zA-Z0-9_-]{1,128}$`)

// Monetary amounts are integer minor currency units, never floating point.
type BillingPlan struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Currency   string `json:"currency"`
	Amount     int64  `json:"amount"`
	ListAmount int64  `json:"list_amount,omitempty"`
	Calls      int    `json:"calls"`
	ValidDays  int    `json:"valid_days"`
	Permanent  bool   `json:"permanent,omitempty" gorm:"not null;default:false"`
}

func (p BillingPlan) Valid() bool {
	return billingIdentifier.MatchString(p.ID) && len(p.Name) > 0 && len(p.Name) <= 128 && p.Currency == "cny" && p.ListAmount >= 0 && (p.ListAmount == 0 || p.ListAmount >= p.Amount) && p.Amount > 0 && p.Amount <= 100000000 && p.Calls > 0 && p.Calls <= 1000000 && p.ValidDays > 0 && p.ValidDays <= 365 && (!p.Permanent || p.ID == PermanentSupportPlanID)
}

type BillingOrder struct {
	ID          string      `json:"id" gorm:"type:varchar(64);primaryKey"`
	UserID      int         `json:"-" gorm:"not null;uniqueIndex:lingtu_billing_request,priority:1"`
	RequestID   string      `json:"-" gorm:"type:varchar(128);not null;uniqueIndex:lingtu_billing_request,priority:2"`
	Plan        BillingPlan `json:"plan" gorm:"embedded;embeddedPrefix:plan_"`
	State       string      `json:"state" gorm:"type:varchar(16);not null"`
	SessionID   *string     `json:"-" gorm:"type:varchar(255);uniqueIndex"`
	CreatedAt   int64       `json:"created_at" gorm:"autoCreateTime:false"`
	PaidAt      int64       `json:"paid_at"`
	Channel     string      `json:"channel" gorm:"type:varchar(16);not null;default:stripe"`
	CreditedAt  int64       `json:"credited_at"`
	ExpiresAt   int64       `json:"expires_at"`
	QRCode      string      `json:"qr_code,omitempty"`
	CheckoutURL string      `json:"checkout_url,omitempty"`
}

func (BillingOrder) TableName() string { return "lingtu_billing_orders" }

// One immutable credit per order; it commits atomically with the actual call grant.
type BillingCredit struct {
	OrderID       string  `gorm:"type:varchar(64);primaryKey"`
	EventID       string  `gorm:"type:varchar(255);not null;uniqueIndex"`
	UserID        int     `gorm:"not null;index"`
	Calls         int     `gorm:"not null"`
	CreatedAt     int64   `gorm:"autoCreateTime:false"`
	ProviderKey   *string `gorm:"type:varchar(768);uniqueIndex"`
	MerchantID    string
	TransactionID string
	Channel       string
	PaidAt        int64
}

func (BillingCredit) TableName() string { return "lingtu_billing_credits" }

type BillingPayment struct {
	OrderID, SessionID, EventID, Currency string
	Channel, MerchantID, TransactionID    string
	PaidAt                                int64
	Amount                                int64
}
type BillingStore struct{ db *gorm.DB }

func NewBillingStore(db *gorm.DB) *BillingStore { return &BillingStore{db: db} }
func (s *BillingStore) Migrate() error {
	if err := s.db.AutoMigrate(&BillingOrder{}, &BillingCredit{}, &PaidGrant{}, &PermanentGrant{}); err != nil {
		return err
	}
	// Existing receipts prove mixing occurred, but cannot establish which past calls
	// consumed trial versus paid or recover the overwritten original trial expiry.
	// Preserve that historical entitlement and expiry rather than invent attribution.
	// A fresh billing-only database has no receipts or trial-grant table yet. Skip
	// the backfill when there is no receipt evidence; production startup migrates
	// trial grants before billing, and a nonempty legacy receipt still requires it.
	var legacyReceipts int64
	if err := s.db.Model(&BillingCredit{}).Where("provider_key IS NULL").Count(&legacyReceipts).Error; err != nil {
		return err
	}
	if legacyReceipts == 0 {
		return nil
	}
	return s.db.Model(&TrialGrant{}).Where("user_id IN (?) AND (provenance IS NULL OR provenance = ?)", s.db.Model(&BillingCredit{}).Select("user_id").Where("provider_key IS NULL"), "").UpdateColumn("provenance", "legacy_mixed").Error
}

func (s *BillingStore) CreateOrder(uid int, request string, plan BillingPlan, now time.Time) (BillingOrder, error) {
	return s.CreateChannelOrder(uid, request, plan, "stripe", now)
}
func (s *BillingStore) CreateChannelOrder(uid int, request string, plan BillingPlan, channel string, now time.Time) (BillingOrder, error) {
	if uid <= 0 || !billingIdentifier.MatchString(request) || !plan.Valid() || (channel != "stripe" && channel != "alipay" && channel != "wechat") {
		return BillingOrder{}, ErrBillingInput
	}
	var existing BillingOrder
	lookup := func() (BillingOrder, error) {
		err := s.db.Where("user_id = ? AND request_id = ?", uid, request).First(&existing).Error
		if err == nil {
			original := plan
			// Retrying an order created before the offer changed reuses its immutable terms.
			if original.Permanent && !existing.Plan.Permanent {
				original.Permanent = false
			}
			if existing.Plan != original || existing.Channel != channel {
				err = ErrBillingConflict
			}
		}
		return existing, err
	}
	if o, err := lookup(); !errors.Is(err, gorm.ErrRecordNotFound) {
		return o, err
	}
	// Hex encoding must fit WeChat's 32-character merchant order number limit.
	var random [16]byte
	if _, err := rand.Read(random[:]); err != nil {
		return BillingOrder{}, err
	}
	order := BillingOrder{ID: hex.EncodeToString(random[:]), UserID: uid, RequestID: request, Plan: plan, State: "pending", Channel: channel, CreatedAt: now.Unix()}
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
		// MySQL reports changed rows by default. An identical retry may match
		// the pending order but change zero rows; confirm its exact stored binding.
		var current BillingOrder
		err := s.db.Where("id = ? AND state = ?", orderID, "pending").First(&current).Error
		if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		if err != nil || current.SessionID == nil || *current.SessionID != session {
			return ErrBillingConflict
		}
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
	if payment.Channel == "" {
		payment.Channel = "stripe"
	}
	if payment.EventID == "" || len(payment.EventID) > 255 || len(payment.MerchantID) > 128 || len(payment.TransactionID) > 255 || (payment.Channel != "stripe" && payment.Channel != "alipay" && payment.Channel != "wechat") {
		return ErrBillingInput
	}
	if payment.Channel == "stripe" {
		if payment.SessionID == "" {
			return ErrBillingInput
		}
		if payment.TransactionID == "" {
			payment.TransactionID = payment.SessionID
		}
	} else if payment.TransactionID == "" || payment.MerchantID == "" || payment.PaidAt <= 0 {
		return ErrBillingInput
	}
	if payment.PaidAt <= 0 {
		payment.PaidAt = now.Unix()
	}
	return NewTrialStore(s.db).transaction(func(tx *gorm.DB) error {
		if err := lockTrialLimits(tx); err != nil {
			return err
		}
		var order BillingOrder
		if err := tx.First(&order, "id = ?", payment.OrderID).Error; err != nil {
			return err
		}
		if order.Channel != payment.Channel || order.Plan.Amount != payment.Amount || order.Plan.Currency != payment.Currency {
			return ErrBillingConflict
		}
		if payment.Channel == "stripe" && (order.SessionID == nil || *order.SessionID != payment.SessionID) {
			return ErrBillingConflict
		}
		key := payment.Channel + ":" + payment.MerchantID + ":" + payment.TransactionID
		if order.State == "paid" {
			var receipt BillingCredit
			if err := tx.First(&receipt, "order_id = ?", order.ID).Error; err != nil {
				return err
			}
			if receipt.ProviderKey != nil && *receipt.ProviderKey != key {
				return ErrBillingConflict
			}
			return nil
		}
		// A delayed provider confirmation may arrive after local close; verified funds
		// must still be credited. The write gate serializes this race with closing.
		if order.State != "pending" && order.State != "closed" && order.State != "reconciling" {
			return ErrBillingConflict
		}
		if err := creditPaidQuota(tx, order, now); err != nil {
			return err
		}
		receipt := BillingCredit{OrderID: order.ID, EventID: payment.EventID, UserID: order.UserID, Calls: order.Plan.Calls, CreatedAt: now.Unix(), ProviderKey: &key, Channel: payment.Channel, MerchantID: payment.MerchantID, TransactionID: payment.TransactionID, PaidAt: payment.PaidAt}
		if err := tx.Create(&receipt).Error; err != nil {
			return err
		}
		return tx.Model(&BillingOrder{}).Where("id = ?", order.ID).Updates(map[string]any{"state": "paid", "paid_at": payment.PaidAt, "credited_at": now.Unix()}).Error
	})
}
func creditPaidQuota(tx *gorm.DB, order BillingOrder, now time.Time) error {
	if order.Plan.Permanent {
		grant := PermanentGrant{UserID: order.UserID}
		if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&grant).Error; err != nil {
			return err
		}
		result := tx.Model(&PermanentGrant{}).
			Where("user_id = ? AND call_limit <= ?", order.UserID, 2000000000-order.Plan.Calls).
			UpdateColumn("call_limit", gorm.Expr("call_limit + ?", order.Plan.Calls))
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrBillingConflict
		}
		// Keep the existing trial extension benefit finite for permanent purchases.
		return extendActiveTrial(tx, order.UserID, now, now.Add(365*24*time.Hour).Unix())
	}
	grant := PaidGrant{UserID: order.UserID}
	if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&grant).Error; err != nil {
		return err
	}
	if err := tx.First(&grant, "user_id = ?", order.UserID).Error; err != nil {
		return err
	}
	limit := grant.Limit
	epoch := grant.Epoch
	if grant.ExpiresAt <= now.Unix() {
		epoch++
		limit = grant.Used + grant.Reserved
	}
	if limit > 2000000000-order.Plan.Calls {
		return ErrBillingConflict
	}
	expiry := max(grant.ExpiresAt, now.Add(365*24*time.Hour).Unix())
	if err := tx.Model(&PaidGrant{}).Where("user_id = ?", order.UserID).Updates(map[string]any{"call_limit": limit + order.Plan.Calls, "expires_at": expiry, "epoch": epoch}).Error; err != nil {
		return err
	}
	return extendActiveTrial(tx, order.UserID, now, expiry)
}

func extendActiveTrial(tx *gorm.DB, userID int, now time.Time, expiry int64) error {
	return tx.Model(&TrialGrant{}).
		Where("user_id = ? AND expires_at > ? AND expires_at < ?", userID, now.Unix(), expiry).
		UpdateColumn("expires_at", expiry).Error
}

func (s *BillingStore) Order(uid int, id string) (BillingOrder, error) {
	var o BillingOrder
	if uid <= 0 || !billingIdentifier.MatchString(id) {
		return o, ErrBillingInput
	}
	err := s.db.Where("user_id = ? AND id = ?", uid, id).First(&o).Error
	return o, err
}
func (s *BillingStore) AttachNativeCheckout(id, qr string, expiry int64) error {
	if !billingIdentifier.MatchString(id) || qr == "" || len(qr) > 8192 || expiry <= 0 {
		return ErrBillingInput
	}
	r := s.db.Model(&BillingOrder{}).Where("id = ? AND channel IN ? AND state IN ? AND (qr_code = ? OR qr_code IS NULL OR qr_code = ?)", id, []string{"alipay", "wechat"}, []string{"pending", "reconciling"}, "", qr).Updates(map[string]any{"qr_code": qr, "expires_at": expiry})
	if r.Error != nil {
		return r.Error
	}
	if r.RowsAffected != 1 {
		var current BillingOrder
		err := s.db.Where("id = ? AND channel IN ? AND state IN ?", id, []string{"alipay", "wechat"}, []string{"pending", "reconciling"}).First(&current).Error
		if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		if err != nil || current.QRCode != qr || current.ExpiresAt != expiry {
			return ErrBillingConflict
		}
	}
	return nil
}
func (s *BillingStore) CloseOrder(uid int, id string) (BillingOrder, error) {
	return s.changeState(uid, id, "closed")
}
func (s *BillingStore) MarkReconciling(uid int, id string) (BillingOrder, error) {
	return s.changeState(uid, id, "reconciling")
}
func (s *BillingStore) changeState(uid int, id, state string) (BillingOrder, error) {
	var o BillingOrder
	err := NewTrialStore(s.db).transaction(func(tx *gorm.DB) error {
		if err := lockTrialLimits(tx); err != nil {
			return err
		}
		var err error
		o, err = NewBillingStore(tx).Order(uid, id)
		if err != nil {
			return err
		}
		if o.State == "paid" || o.State == "closed" {
			return nil
		}
		if err = tx.Model(&BillingOrder{}).Where("id = ?", id).UpdateColumn("state", state).Error; err != nil {
			return err
		}
		o.State = state
		return nil
	})
	return o, err
}

// LookupOrder is for authenticated provider callbacks only. Client handlers use Order.
func (s *BillingStore) LookupOrder(id string) (BillingOrder, error) {
	var o BillingOrder
	if !billingIdentifier.MatchString(id) {
		return o, ErrBillingInput
	}
	err := s.db.First(&o, "id = ?", id).Error
	return o, err
}
func (s *BillingStore) MarkPending(uid int, id string) (BillingOrder, error) {
	return s.changeState(uid, id, "pending")
}
