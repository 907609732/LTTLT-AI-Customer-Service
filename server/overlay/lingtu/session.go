package lingtu

import (
	"crypto/hmac"
	"errors"
	"strconv"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"gorm.io/gorm"
)

var ErrSessionInvalid = errors.New("managed session invalid")
var errRotationRace = errors.New("managed refresh rotation raced")

const clientAudience = "lingtu-desktop"

type ManagedSession struct {
	SID           string `gorm:"column:sid;type:varchar(64);primaryKey"`
	UserID        int    `gorm:"not null;index"`
	AuthVersion   int64  `gorm:"not null"`
	RefreshHash   string `gorm:"type:varchar(64);not null"`
	PreviousHash  string `gorm:"type:varchar(64)"`
	OperationHash string `gorm:"type:varchar(64)"`
	Recovery      string `gorm:"type:text"`
	ExpiresAt     int64  `gorm:"not null;index"`
}

func (ManagedSession) TableName() string { return "lingtu_client_sessions" }

type ClientIdentity struct {
	UserID      int
	SID         string
	AuthVersion int64
}
type TokenBundle struct {
	AccessToken     string `json:"access_token"`
	RefreshToken    string `json:"refresh_token"`
	AccessExpiresAt int64  `json:"access_expires_at"`
	ExpiresAt       int64  `json:"expires_at"`
	UserID          int    `json:"user_id"`
	SessionID       string `json:"session_id"`
	TokenType       string `json:"token_type"`
}
type clientClaims struct {
	SID         string `json:"sid"`
	AuthVersion int64  `json:"uv"`
	Purpose     string `json:"purpose"`
	jwt.RegisteredClaims
}
type SessionStore struct {
	db       *gorm.DB
	vault    *Vault
	issuer   string
	validate func(int, string, int64) error
}

func NewSessionStore(db *gorm.DB, vault *Vault, issuer string, validate func(int, string, int64) error) *SessionStore {
	return &SessionStore{db: db, vault: vault, issuer: issuer, validate: validate}
}
func (s *SessionStore) Migrate() error { return s.db.AutoMigrate(&ManagedSession{}) }
func (s *SessionStore) Create(userID int, sid string, authVersion int64, now time.Time, deadline ...int64) (TokenBundle, error) {
	if userID <= 0 || sid == "" || len(sid) > 64 || authVersion <= 0 || s.validate == nil {
		return TokenBundle{}, ErrSessionInvalid
	}
	if err := s.validate(userID, sid, authVersion); err != nil {
		return TokenBundle{}, err
	}
	secret, err := randomSecret()
	if err != nil {
		return TokenBundle{}, err
	}
	row := ManagedSession{SID: sid, UserID: userID, AuthVersion: authVersion, RefreshHash: s.vault.digest("refresh", secret), ExpiresAt: now.Add(30 * 24 * time.Hour).Unix()}
	if len(deadline) > 0 {
		if deadline[0] <= now.Unix() || deadline[0] > row.ExpiresAt {
			return TokenBundle{}, ErrSessionInvalid
		}
		row.ExpiresAt = deadline[0]
	}
	bundle, err := s.bundle(row, secret, now)
	if err != nil {
		return TokenBundle{}, err
	}
	if err = s.db.Create(&row).Error; err != nil {
		return TokenBundle{}, err
	}
	return bundle, nil
}
func (s *SessionStore) bundle(row ManagedSession, secret string, now time.Time) (TokenBundle, error) {
	expires := min(now.Add(15*time.Minute).Unix(), row.ExpiresAt)
	claims := clientClaims{SID: row.SID, AuthVersion: row.AuthVersion, Purpose: "client_access", RegisteredClaims: jwt.RegisteredClaims{
		Issuer: s.issuer, Subject: strconv.Itoa(row.UserID), Audience: jwt.ClaimStrings{clientAudience}, IssuedAt: jwt.NewNumericDate(now), ExpiresAt: jwt.NewNumericDate(time.Unix(expires, 0)),
	}}
	signed, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(s.vault.derive("client-access"))
	if err != nil {
		return TokenBundle{}, err
	}
	return TokenBundle{AccessToken: signed, RefreshToken: "ltc." + row.SID + "." + secret, AccessExpiresAt: expires, ExpiresAt: row.ExpiresAt, UserID: row.UserID, SessionID: row.SID, TokenType: "Bearer"}, nil
}
func (s *SessionStore) Authenticate(raw string, now time.Time) (ClientIdentity, error) {
	claims := &clientClaims{}
	token, err := jwt.ParseWithClaims(raw, claims, func(*jwt.Token) (any, error) { return s.vault.derive("client-access"), nil }, jwt.WithValidMethods([]string{"HS256"}), jwt.WithIssuer(s.issuer), jwt.WithAudience(clientAudience), jwt.WithExpirationRequired(), jwt.WithTimeFunc(func() time.Time { return now }))
	if err != nil || !token.Valid || claims.Purpose != "client_access" {
		return ClientIdentity{}, ErrSessionInvalid
	}
	uid, err := strconv.Atoi(claims.Subject)
	if err != nil || uid <= 0 {
		return ClientIdentity{}, ErrSessionInvalid
	}
	var row ManagedSession
	if err = s.db.First(&row, "sid = ?", claims.SID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ClientIdentity{}, ErrSessionInvalid
		}
		return ClientIdentity{}, err
	}
	if row.UserID != uid || row.AuthVersion != claims.AuthVersion || row.ExpiresAt <= now.Unix() {
		return ClientIdentity{}, ErrSessionInvalid
	}
	if s.validate == nil {
		return ClientIdentity{}, ErrSessionInvalid
	}
	if err = s.validate(uid, row.SID, row.AuthVersion); err != nil {
		return ClientIdentity{}, err
	}
	return ClientIdentity{UserID: uid, SID: row.SID, AuthVersion: row.AuthVersion}, nil
}
func (s *SessionStore) Refresh(raw, operation string, now time.Time) (TokenBundle, error) {
	parts := strings.Split(raw, ".")
	if len(parts) != 3 || parts[0] != "ltc" || len(parts[1]) > 64 || len(parts[2]) != 43 || len(operation) < 8 || len(operation) > 128 {
		return TokenBundle{}, ErrSessionInvalid
	}
	var bundle TokenBundle
	for range 4 {
		err := NewTrialStore(s.db).transaction(func(tx *gorm.DB) error {
			var row ManagedSession
			if err := tx.First(&row, "sid = ?", parts[1]).Error; err != nil {
				if errors.Is(err, gorm.ErrRecordNotFound) {
					return ErrSessionInvalid
				}
				return err
			}
			if row.ExpiresAt <= now.Unix() {
				return ErrSessionInvalid
			}
			if s.validate == nil {
				return ErrSessionInvalid
			}
			if err := s.validate(row.UserID, row.SID, row.AuthVersion); err != nil {
				return err
			}
			hash := s.vault.digest("refresh", parts[2])
			opHash := s.vault.digest("rotation", operation)
			if hmac.Equal([]byte(row.PreviousHash), []byte(hash)) && hmac.Equal([]byte(row.OperationHash), []byte(opHash)) {
				plain, err := s.vault.Open("refresh-recovery:"+row.SID, row.Recovery)
				if err != nil {
					return ErrSessionInvalid
				}
				fields := strings.Split(string(plain), "\n")
				if len(fields) != 3 {
					return ErrSessionInvalid
				}
				accessExpiry, err := strconv.ParseInt(fields[2], 10, 64)
				if err != nil {
					return ErrSessionInvalid
				}
				bundle = TokenBundle{AccessToken: fields[0], RefreshToken: fields[1], AccessExpiresAt: accessExpiry, ExpiresAt: row.ExpiresAt, UserID: row.UserID, SessionID: row.SID, TokenType: "Bearer"}
				return nil
			}
			if !hmac.Equal([]byte(row.RefreshHash), []byte(hash)) {
				return ErrSessionInvalid
			}
			secret, err := randomSecret()
			if err != nil {
				return err
			}
			bundle, err = s.bundle(row, secret, now)
			if err != nil {
				return err
			}
			recovery, err := s.vault.Seal("refresh-recovery:"+row.SID, []byte(bundle.AccessToken+"\n"+bundle.RefreshToken+"\n"+strconv.FormatInt(bundle.AccessExpiresAt, 10)))
			if err != nil {
				return err
			}
			result := tx.Model(&ManagedSession{}).Where("sid = ? AND refresh_hash = ?", row.SID, hash).Updates(map[string]any{"refresh_hash": s.vault.digest("refresh", secret), "previous_hash": hash, "operation_hash": opHash, "recovery": recovery})
			if result.Error != nil {
				return result.Error
			}
			if result.RowsAffected != 1 {
				return errRotationRace
			}
			return nil
		})
		if errors.Is(err, errRotationRace) {
			continue
		}
		return bundle, err
	}
	return TokenBundle{}, ErrSessionInvalid
}
