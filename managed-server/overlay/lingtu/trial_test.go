package lingtu

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/glebarez/sqlite"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func trialDB(t *testing.T) *gorm.DB {
	t.Helper()
	var dialect gorm.Dialector = sqlite.Open(filepath.Join(t.TempDir(), "trial.db") + "?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)")
	if engine := os.Getenv("LINGTU_TEST_ENGINE"); engine != "" {
		dsn := os.Getenv("LINGTU_TEST_DSN")
		if !strings.Contains(dsn, "lingtu_test") {
			t.Fatal("database matrix requires isolated lingtu_test database")
		}
		switch engine {
		case "mysql":
			dialect = mysql.Open(dsn)
		case "postgres":
			dialect = postgres.Open(dsn)
		default:
			t.Fatal("unsupported test engine")
		}
	}
	db, err := gorm.Open(dialect, &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	sql, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { sql.Close() })
	if os.Getenv("LINGTU_TEST_ENGINE") != "" {
		// CI-only database, never a production connection. Tests run sequentially.
		if err := db.Migrator().DropTable(&TrialRequest{}, &TrialGrant{}, &ManagedSession{}); err != nil {
			t.Fatal(err)
		}
	}
	return db
}

func TestTrialGrantIsNotResetByLoginOrRestart(t *testing.T) {
	db := trialDB(t)
	s := NewTrialStore(db)
	if err := s.Migrate(); err != nil {
		t.Fatal(err)
	}
	now := time.Unix(1800000000, 0)
	if err := s.Grant(42, now, 20, 7*24*time.Hour); err != nil {
		t.Fatal(err)
	}
	for i := range 20 {
		id := fmt.Sprint(i)
		r, err := s.Reserve(42, id, "hash", now)
		if err != nil || !r.Created {
			t.Fatalf("reserve %d: %+v %v", i, r, err)
		}
		if err = s.Settle(42, id, "success"); err != nil {
			t.Fatal(err)
		}
	}
	s = NewTrialStore(db)
	if err := s.Migrate(); err != nil {
		t.Fatal(err)
	}
	if err := s.Grant(42, now.Add(time.Hour), 100, 30*24*time.Hour); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Reserve(42, "extra", "hash", now); !errors.Is(err, ErrTrialUnavailable) {
		t.Fatalf("spent trial reset: %v", err)
	}
}

func TestTrialExpiryBoundaryAndRequestDeduplication(t *testing.T) {
	s := NewTrialStore(trialDB(t))
	if err := s.Migrate(); err != nil {
		t.Fatal(err)
	}
	now := time.Unix(1800000000, 0)
	if err := s.Grant(1, now, 20, 7*24*time.Hour); err != nil {
		t.Fatal(err)
	}
	r, err := s.Reserve(1, "same", "a", now)
	if err != nil || !r.Created {
		t.Fatal(r, err)
	}
	r, err = s.Reserve(1, "same", "a", now)
	if err != nil || r.Created || r.State != "pending" {
		t.Fatal(r, err)
	}
	if _, err = s.Reserve(1, "same", "b", now); !errors.Is(err, ErrRequestConflict) {
		t.Fatal(err)
	}
	if _, err = s.Reserve(2, "same", "a", now); !errors.Is(err, ErrTrialUnavailable) {
		t.Fatal(err)
	}
	if _, err = s.Reserve(1, "edge", "a", now.Add(7*24*time.Hour)); !errors.Is(err, ErrTrialUnavailable) {
		t.Fatal(err)
	}
}

func TestConcurrentLastTrialReservation(t *testing.T) {
	s := NewTrialStore(trialDB(t))
	if err := s.Migrate(); err != nil {
		t.Fatal(err)
	}
	now := time.Unix(1800000000, 0)
	if err := s.Grant(1, now, 1, 7*24*time.Hour); err != nil {
		t.Fatal(err)
	}
	var won atomic.Int32
	var wg sync.WaitGroup
	for i := range 12 {
		wg.Go(func() {
			r, err := s.Reserve(1, fmt.Sprint(i), "a", now)
			if err == nil && r.Created {
				won.Add(1)
			} else if !errors.Is(err, ErrTrialUnavailable) {
				t.Errorf("unexpected: %v", err)
			}
		})
	}
	wg.Wait()
	if won.Load() != 1 {
		t.Fatalf("last call reserved %d times", won.Load())
	}
}

func TestSettlementRefundAndUncertainHold(t *testing.T) {
	s := NewTrialStore(trialDB(t))
	if err := s.Migrate(); err != nil {
		t.Fatal(err)
	}
	now := time.Unix(1800000000, 0)
	if err := s.Grant(1, now, 1, 7*24*time.Hour); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Reserve(1, "first", "a", now); err != nil {
		t.Fatal(err)
	}
	if err := s.Settle(1, "first", "uncertain"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Reserve(1, "next", "a", now); !errors.Is(err, ErrTrialUnavailable) {
		t.Fatal(err)
	}
	if err := s.Settle(1, "first", "failed"); err != nil {
		t.Fatal(err)
	}
	if err := s.Settle(1, "first", "failed"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Reserve(1, "next", "a", now); err != nil {
		t.Fatal(err)
	}
	if err := s.Settle(1, "next", "success"); err != nil {
		t.Fatal(err)
	}
	if err := s.Settle(1, "next", "failed"); !errors.Is(err, ErrSettlementConflict) {
		t.Fatal(err)
	}
	if _, err := s.Reserve(1, "last", "a", now); !errors.Is(err, ErrTrialUnavailable) {
		t.Fatal(err)
	}
}
