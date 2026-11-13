package lingtu

import (
	"bytes"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestDeviceGrantPendingSlowdownExpiryAndOneTimeExchange(t *testing.T) {
	db := trialDB(t)
	v, _ := NewVault(bytes.Repeat([]byte{8}, 32))
	ss := NewSessionStore(db, v, "https://api.example", func(int, string, int64) error { return nil })
	ds := NewDeviceStore(db, v, ss, "https://account.example/lingtu/device")
	if err := ss.Migrate(); err != nil {
		t.Fatal(err)
	}
	if err := ds.Migrate(); err != nil {
		t.Fatal(err)
	}
	now := time.Unix(1800000000, 0)
	flow, err := ds.Authorize(now)
	if err != nil {
		t.Fatal(err)
	}
	if flow.Interval != 5 || flow.ExpiresIn != 600 {
		t.Fatal(flow)
	}
	if _, err = ds.Poll(flow.DeviceCode, now); !errors.Is(err, ErrAuthorizationPending) {
		t.Fatal(err)
	}
	if _, err = ds.Poll(flow.DeviceCode, now.Add(time.Second)); !errors.Is(err, ErrSlowDown) {
		t.Fatal(err)
	}
	if err = ds.Approve(flow.UserCode, 9, "native-device", 1, now.Add(2*time.Second)); err != nil {
		t.Fatal(err)
	}
	bundle, err := ds.Poll(flow.DeviceCode, now.Add(11*time.Second))
	if err != nil || bundle.UserID != 9 {
		t.Fatal(bundle, err)
	}
	if _, err = ds.Poll(flow.DeviceCode, now.Add(30*time.Second)); !errors.Is(err, ErrDeviceInvalid) {
		t.Fatal(err)
	}
	if err = ds.Approve(flow.UserCode, 10, "another", 1, now.Add(30*time.Second)); !errors.Is(err, ErrDeviceInvalid) {
		t.Fatal(err)
	}
	other, err := ds.Authorize(now)
	if err != nil {
		t.Fatal(err)
	}
	if err = ds.Approve(other.UserCode, 9, "new", 1, now.Add(10*time.Minute)); !errors.Is(err, ErrDeviceExpired) {
		t.Fatal(err)
	}
	if _, err = ds.Poll(other.DeviceCode, now.Add(10*time.Minute)); !errors.Is(err, ErrDeviceExpired) {
		t.Fatal(err)
	}
}

func TestDeviceConcurrentExchangeCreatesOnlyOneSession(t *testing.T) {
	db := trialDB(t)
	v, _ := NewVault(bytes.Repeat([]byte{8}, 32))
	ss := NewSessionStore(db, v, "https://api.example", func(int, string, int64) error { return nil })
	ds := NewDeviceStore(db, v, ss, "https://account.example/lingtu/device")
	if err := ss.Migrate(); err != nil {
		t.Fatal(err)
	}
	if err := ds.Migrate(); err != nil {
		t.Fatal(err)
	}
	now := time.Unix(1800000000, 0)
	flow, err := ds.Authorize(now)
	if err != nil {
		t.Fatal(err)
	}
	if err = ds.Approve(flow.UserCode, 9, "native", 1, now); err != nil {
		t.Fatal(err)
	}
	var count atomic.Int32
	var wg sync.WaitGroup
	for range 8 {
		wg.Go(func() {
			if _, err := ds.Poll(flow.DeviceCode, now.Add(6*time.Second)); err == nil {
				count.Add(1)
			}
		})
	}
	wg.Wait()
	if count.Load() != 1 {
		t.Fatalf("exchange succeeded %d times", count.Load())
	}
	var rows int64
	db.Model(&ManagedSession{}).Count(&rows)
	if rows != 1 {
		t.Fatal(rows)
	}
}
