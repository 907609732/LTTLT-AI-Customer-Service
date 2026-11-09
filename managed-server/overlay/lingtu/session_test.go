package lingtu

import (
	"bytes"
	"errors"
	"testing"
	"time"
)

func TestDesktopRefreshRecoversLostResponseWithoutExtendingExpiry(t *testing.T) {
	db := trialDB(t)
	vault, _ := NewVault(bytes.Repeat([]byte{4}, 32))
	sessions := NewSessionStore(db, vault, "https://api-kefu.example", func(int, string, int64) error { return nil })
	if err := sessions.Migrate(); err != nil {
		t.Fatal(err)
	}
	now := time.Unix(1800000000, 0)
	first, err := sessions.Create(9, "native-session", 2, now)
	if err != nil {
		t.Fatal(err)
	}
	second, err := sessions.Refresh(first.RefreshToken, "persisted-operation-1", now.Add(time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	// The server is restarted after rotating; the client still has its previous token.
	sessions = NewSessionStore(db, vault, "https://api-kefu.example", func(int, string, int64) error { return nil })
	recovered, err := sessions.Refresh(first.RefreshToken, "persisted-operation-1", now.Add(24*time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	if recovered.RefreshToken != second.RefreshToken || recovered.AccessToken != second.AccessToken {
		t.Fatal("refresh retry did not return original rotation")
	}
	if recovered.ExpiresAt != 1802592000 {
		t.Fatalf("absolute deadline changed: %d", recovered.ExpiresAt)
	}
	if _, err = sessions.Refresh(first.RefreshToken, "different-operation", now.Add(time.Hour)); !errors.Is(err, ErrSessionInvalid) {
		t.Fatal(err)
	}
	if _, err = sessions.Refresh(second.RefreshToken, "operation-2", now.Add(30*24*time.Hour)); !errors.Is(err, ErrSessionInvalid) {
		t.Fatal(err)
	}
}

func TestDesktopAccessChecksAudienceAndLiveRevocation(t *testing.T) {
	vault, _ := NewVault(bytes.Repeat([]byte{4}, 32))
	disabled := false
	s := NewSessionStore(trialDB(t), vault, "https://api-kefu.example", func(uid int, sid string, version int64) error {
		if uid != 9 || sid != "native-session" || version != 2 || disabled {
			return ErrSessionInvalid
		}
		return nil
	})
	if err := s.Migrate(); err != nil {
		t.Fatal(err)
	}
	now := time.Unix(1800000000, 0)
	bundle, err := s.Create(9, "native-session", 2, now)
	if err != nil {
		t.Fatal(err)
	}
	identity, err := s.Authenticate(bundle.AccessToken, now)
	if err != nil || identity.UserID != 9 {
		t.Fatal(identity, err)
	}
	if _, err = s.Authenticate(bundle.RefreshToken, now); err == nil {
		t.Fatal("refresh token used as access")
	}
	other := NewSessionStore(s.db, vault, "https://another.example", s.validate)
	if _, err = other.Authenticate(bundle.AccessToken, now); err == nil {
		t.Fatal("wrong issuer accepted")
	}
	if _, err = s.Authenticate(bundle.AccessToken, now.Add(15*time.Minute)); err == nil {
		t.Fatal("expired access accepted")
	}
	disabled = true
	if _, err = s.Authenticate(bundle.AccessToken, now); err == nil {
		t.Fatal("revoked user retained access")
	}
	if _, err = s.Refresh(bundle.RefreshToken, "operation-1", now); err == nil {
		t.Fatal("revoked user refreshed")
	}
}
