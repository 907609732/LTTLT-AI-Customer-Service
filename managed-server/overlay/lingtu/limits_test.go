package lingtu

import (
	"errors"
	"fmt"
	"gorm.io/gorm"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestLimitedTrialLifecycle(t *testing.T) {
	db := limitedTrialDB(t)
	s := NewTrialStore(db)
	if err := s.Migrate(); err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 11, 9, 23, 59, 50, 0, time.UTC)
	for _, uid := range []int{1, 2} {
		if err := s.Grant(uid, now, 20, 24*time.Hour); err != nil {
			t.Fatal(err)
		}
	}
	limits := TrialLimits{1, 5, 1, 1}
	reserve := func(uid int, id string, at time.Time, want error) {
		t.Helper()
		_, err := s.ReserveWithLimits(uid, id, "hash", at, limits)
		if !errors.Is(err, want) {
			t.Fatalf("%s: got %v want %v", id, err, want)
		}
	}
	reserve(1, "a", now, nil)
	r, err := s.ReserveWithLimits(1, "a", "hash", now, limits)
	if err != nil || r.Created {
		t.Fatal(r, err)
	}
	if _, err = s.ReserveWithLimits(1, "a", "other", now, limits); !errors.Is(err, ErrRequestConflict) {
		t.Fatal(err)
	}
	reserve(1, "b", now, ErrAccountConcurrency)
	reserve(2, "b", now, ErrGlobalConcurrency)
	reserve(2, "midnight", now.Add(20*time.Second), ErrGlobalConcurrency)
	if err = s.Settle(1, "a", "uncertain"); err != nil {
		t.Fatal(err)
	}
	reserve(2, "c", now, ErrDailyCallLimit)
	reserve(2, "next", now.Add(20*time.Second), nil)
	if err = s.Settle(1, "a", "failed"); err != nil {
		t.Fatal(err)
	}
	if err = s.Settle(2, "next", "success"); err != nil {
		t.Fatal(err)
	}
	reserve(1, "refund", now, nil)
	if err = NewTrialStore(db).Migrate(); err != nil {
		t.Fatal(err)
	}
	if err = NewTrialStore(db).RecoverPending(); err != nil {
		t.Fatal(err)
	}
	r, err = s.ReserveWithLimits(1, "refund", "hash", now, limits)
	if err != nil || r.State != "uncertain" || r.Created {
		t.Fatal(r, err)
	}
	if err = s.Settle(1, "refund", "failed"); err != nil {
		t.Fatal(err)
	}
	reserve(2, "again", now, nil)
	if err = s.Settle(2, "again", "failed"); err != nil {
		t.Fatal(err)
	}
}

func limitedTrialDB(t *testing.T) *gorm.DB {
	t.Helper()
	db := trialDB(t)
	tables := []any{&trialLimitedRequest{}, &trialDailyBudget{}, &trialLimitGate{}}
	if err := db.Migrator().DropTable(tables...); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := db.Migrator().DropTable(tables...); err != nil {
			t.Error(err)
		}
	})
	return db
}

func TestTrialLimitsRateCountsFailuresAndDedupe(t *testing.T) {
	db := limitedTrialDB(t)
	s := NewTrialStore(db)
	if err := s.Migrate(); err != nil {
		t.Fatal(err)
	}
	now := time.Unix(1800000000, 0)
	if err := s.Grant(7, now, 20, 24*time.Hour); err != nil {
		t.Fatal(err)
	}
	limits := TrialLimits{1, 5, 4, 200}
	for i := 0; i < 5; i++ {
		id := fmt.Sprint(i)
		if _, err := s.ReserveWithLimits(7, id, "hash", now, limits); err != nil {
			t.Fatal(err)
		}
		if err := s.Settle(7, id, "failed"); err != nil {
			t.Fatal(err)
		}
		if r, err := s.ReserveWithLimits(7, id, "hash", now, limits); err != nil || r.Created {
			t.Fatal(r, err)
		}
	}
	if _, err := s.ReserveWithLimits(7, "blocked", "hash", now.Add(59*time.Second), limits); !errors.Is(err, ErrTrialRateLimit) {
		t.Fatal(err)
	}
	if _, err := s.ReserveWithLimits(7, "boundary", "hash", now.Add(time.Minute), limits); err != nil {
		t.Fatal(err)
	}
}

func TestTrialLimitsConcurrentReservations(t *testing.T) {
	for _, kind := range []string{"account", "global", "daily", "rate", "dedupe"} {
		t.Run(kind, func(t *testing.T) {
			db := limitedTrialDB(t)
			s := NewTrialStore(db)
			if err := s.Migrate(); err != nil {
				t.Fatal(err)
			}
			now := time.Unix(1800000000, 0)
			for uid := 1; uid <= 8; uid++ {
				if err := s.Grant(uid, now, 20, 24*time.Hour); err != nil {
					t.Fatal(err)
				}
			}
			limits := TrialLimits{20, 20, 20, 20}
			switch kind {
			case "account":
				limits.PerAccountConcurrent = 1
			case "global":
				limits.GlobalConcurrent = 1
			case "daily":
				limits.DailyCalls = 1
			case "rate":
				limits.RequestsPerMinute = 1
			}
			var wg sync.WaitGroup
			var created atomic.Int32
			for i := 0; i < 8; i++ {
				wg.Add(1)
				go func(i int) {
					defer wg.Done()
					uid := 1
					id := fmt.Sprint(i)
					if kind == "global" || kind == "daily" {
						uid = i + 1
					}
					if kind == "dedupe" {
						id = "same"
					}
					r, err := s.ReserveWithLimits(uid, id, "hash", now, limits)
					if err == nil && r.Created {
						created.Add(1)
					} else if err != nil && !errors.Is(err, ErrAccountConcurrency) && !errors.Is(err, ErrGlobalConcurrency) && !errors.Is(err, ErrDailyCallLimit) && !errors.Is(err, ErrTrialRateLimit) {
						t.Error(err)
					}
				}(i)
			}
			wg.Wait()
			if created.Load() != 1 {
				t.Fatalf("created %d", created.Load())
			}
		})
	}
}

func TestTrialLimitsUncertainSuccessAndQuotaRollback(t *testing.T) {
	db := limitedTrialDB(t)
	s := NewTrialStore(db)
	if err := s.Migrate(); err != nil {
		t.Fatal(err)
	}
	now := time.Unix(1800000000, 0)
	limits := TrialLimits{1, 5, 1, 2}
	if _, err := s.ReserveWithLimits(9, "no-grant", "hash", now, limits); !errors.Is(err, ErrTrialUnavailable) {
		t.Fatal(err)
	}
	for _, uid := range []int{1, 2} {
		if err := s.Grant(uid, now, 20, time.Hour); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := s.ReserveWithLimits(1, "a", "hash", now, limits); err != nil {
		t.Fatal(err)
	}
	if err := s.Settle(1, "a", "uncertain"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.ReserveWithLimits(2, "b", "hash", now, limits); err != nil {
		t.Fatal(err)
	}
	if err := s.Settle(1, "a", "success"); err != nil {
		t.Fatal(err)
	}
	if err := s.Settle(1, "a", "success"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.ReserveWithLimits(1, "c", "hash", now, limits); !errors.Is(err, ErrGlobalConcurrency) {
		t.Fatal(err)
	}
	if err := s.Settle(2, "b", "failed"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.ReserveWithLimits(1, "c", "hash", now, limits); err != nil {
		t.Fatal(err)
	}
	var grant TrialGrant
	if err := db.First(&grant, 1).Error; err != nil {
		t.Fatal(err)
	}
	if grant.Used != 1 || grant.Reserved != 1 {
		t.Fatal(grant)
	}
}
