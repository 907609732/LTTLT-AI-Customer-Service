package lingtu

import (
	"crypto/rand"
	"encoding/base32"
	"errors"
	"net/url"
	"strings"
	"time"

	"gorm.io/gorm"
)

var (
	ErrAuthorizationPending = errors.New("authorization_pending")
	ErrSlowDown             = errors.New("slow_down")
	ErrDeviceInvalid        = errors.New("invalid_grant")
	ErrDeviceExpired        = errors.New("expired_token")
)

type DeviceGrant struct {
	DeviceHash       string `gorm:"type:varchar(64);primaryKey"`
	UserCodeHash     string `gorm:"type:varchar(64);not null;uniqueIndex"`
	State            string `gorm:"type:varchar(16);not null"`
	UserID           int
	NativeSID        string `gorm:"column:native_sid;type:varchar(64)"`
	AuthVersion      int64
	SessionExpiresAt int64
	ExpiresAt        int64 `gorm:"not null;index"`
	LastPoll         int64
	Interval         int
}

func (DeviceGrant) TableName() string { return "lingtu_device_grants" }

type DeviceAuthorization struct {
	DeviceCode              string `json:"device_code"`
	UserCode                string `json:"user_code"`
	VerificationURI         string `json:"verification_uri"`
	VerificationURIComplete string `json:"verification_uri_complete"`
	ExpiresIn               int    `json:"expires_in"`
	Interval                int    `json:"interval"`
}
type DeviceStore struct {
	db              *gorm.DB
	vault           *Vault
	sessions        *SessionStore
	verificationURI string
}

func NewDeviceStore(db *gorm.DB, vault *Vault, sessions *SessionStore, verificationURI string) *DeviceStore {
	return &DeviceStore{db: db, vault: vault, sessions: sessions, verificationURI: verificationURI}
}
func (s *DeviceStore) Migrate() error { return s.db.AutoMigrate(&DeviceGrant{}) }
func (s *DeviceStore) Authorize(now time.Time) (DeviceAuthorization, error) {
	deviceCode, err := randomSecret()
	if err != nil {
		return DeviceAuthorization{}, err
	}
	raw := make([]byte, 5)
	if _, err = rand.Read(raw); err != nil {
		return DeviceAuthorization{}, err
	}
	code := base32.NewEncoding("ABCDEFGHJKLMNPQRSTUVWXYZ23456789").EncodeToString(raw)
	code = code[:4] + "-" + code[4:]
	row := DeviceGrant{DeviceHash: s.vault.digest("device", deviceCode), UserCodeHash: s.vault.digest("user-code", code), State: "pending", ExpiresAt: now.Add(10 * time.Minute).Unix(), Interval: 5}
	if err = s.db.Create(&row).Error; err != nil {
		return DeviceAuthorization{}, err
	}
	return DeviceAuthorization{DeviceCode: deviceCode, UserCode: code, VerificationURI: s.verificationURI, VerificationURIComplete: s.verificationURI + "?user_code=" + url.QueryEscape(code), ExpiresIn: 600, Interval: 5}, nil
}
func (s *DeviceStore) Approve(code string, userID int, nativeSID string, authVersion int64, now time.Time, deadline ...int64) error {
	if userID <= 0 || nativeSID == "" || len(nativeSID) > 64 || authVersion <= 0 || len(code) != 9 {
		return ErrDeviceInvalid
	}
	hash := s.vault.digest("user-code", strings.ToUpper(code))
	expires := now.Add(30 * 24 * time.Hour).Unix()
	if len(deadline) > 0 {
		expires = deadline[0]
	}
	if expires <= now.Unix() || expires > now.Add(30*24*time.Hour).Unix() {
		return ErrDeviceInvalid
	}
	result := s.db.Model(&DeviceGrant{}).Where("user_code_hash = ? AND state = ? AND expires_at > ?", hash, "pending", now.Unix()).Updates(map[string]any{"state": "approved", "user_id": userID, "native_sid": nativeSID, "auth_version": authVersion, "session_expires_at": expires})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 1 {
		return nil
	}
	var row DeviceGrant
	if err := s.db.First(&row, "user_code_hash = ?", hash).Error; err != nil {
		return ErrDeviceInvalid
	}
	if row.ExpiresAt <= now.Unix() {
		return ErrDeviceExpired
	}
	return ErrDeviceInvalid
}
func (s *DeviceStore) Poll(code string, now time.Time) (TokenBundle, error) {
	if len(code) != 43 {
		return TokenBundle{}, ErrDeviceInvalid
	}
	var bundle TokenBundle
	var protocolErr error
	err := NewTrialStore(s.db).transaction(func(tx *gorm.DB) error {
		protocolErr = nil
		var row DeviceGrant
		if err := tx.First(&row, "device_hash = ?", s.vault.digest("device", code)).Error; err != nil {
			return ErrDeviceInvalid
		}
		if row.ExpiresAt <= now.Unix() {
			return ErrDeviceExpired
		}
		if row.State == "consumed" {
			return ErrDeviceInvalid
		}
		updates := map[string]any{"last_poll": now.Unix()}
		if row.LastPoll != 0 && now.Unix() < row.LastPoll+int64(row.Interval) {
			updates["interval"] = row.Interval + 5
			protocolErr = ErrSlowDown
		} else if row.State == "pending" {
			protocolErr = ErrAuthorizationPending
		} else if row.State == "approved" {
			updates["state"] = "consumed"
		} else {
			return ErrDeviceInvalid
		}
		result := tx.Model(&DeviceGrant{}).Where("device_hash = ? AND state = ? AND last_poll = ?", row.DeviceHash, row.State, row.LastPoll).Updates(updates)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrDeviceInvalid
		}
		if protocolErr != nil {
			return nil
		}
		transactionalSessions := *s.sessions
		transactionalSessions.db = tx
		var err error
		bundle, err = transactionalSessions.Create(row.UserID, row.NativeSID, row.AuthVersion, now, row.SessionExpiresAt)
		return err
	})
	if err != nil {
		return TokenBundle{}, err
	}
	return bundle, protocolErr
}
