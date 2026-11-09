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

func identityFixture(t *testing.T) *gorm.DB {
	t.Helper()
	db := trialDB(t)
	tables := []any{&TrialIdentityClaim{}, &TrialVerifiedEmail{}, &identityUser{}, &identityProvider{}, &identityBinding{}}
	if err := db.Migrator().DropTable(tables...); err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&identityUser{}, &identityProvider{}, &identityBinding{}); err != nil {
		t.Fatal(err)
	}
	if err := MigrateManaged(db); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Migrator().DropTable(tables...) })
	return db
}
func TestTrialIdentityEmailSurvivesDeletionAndDoesNotMerge(t *testing.T) {
	db := identityFixture(t)
	now := time.Now()
	for _, uid := range []int{1, 2} {
		if err := db.Create(&identityUser{ID: uid, Email: " OWNER@Example.test "}).Error; err != nil {
			t.Fatal(err)
		}
	}
	if err := RecordVerifiedTrialEmail(db, 1, "owner@example.test", now); err != nil {
		t.Fatal(err)
	}
	if err := EnsureManagedAccount(db, 1, now); err != nil {
		t.Fatal(err)
	}
	db.Where("id = ?", 1).Delete(&identityUser{})
	db.Where("user_id = ?", 1).Delete(&ManagedAccount{})
	db.Where("user_id = ?", 1).Delete(&TrialGrant{})
	if err := MigrateManaged(db); err != nil {
		t.Fatal(err)
	}
	if err := RecordVerifiedTrialEmail(db, 2, "Owner@EXAMPLE.test", now); err != nil {
		t.Fatal(err)
	}
	if err := EnsureManagedAccount(db, 2, now); err != nil {
		t.Fatal(err)
	}
	var grant TrialGrant
	if err := db.First(&grant, 2).Error; err != nil || grant.Limit != 0 {
		t.Fatal(grant, err)
	}
	var claim TrialIdentityClaim
	if err := db.First(&claim).Error; err != nil || claim.UserID != 1 {
		t.Fatal(claim, err)
	}
}
func TestTrialIdentitySocialCaseScopeAndLaterBind(t *testing.T) {
	db := identityFixture(t)
	now := time.Now()
	db.Create(&identityProvider{ID: 1, Slug: "ltwechat"})
	db.Create(&identityProvider{ID: 2, Slug: "ltdingtalk"})
	for uid := 1; uid <= 4; uid++ {
		db.Create(&identityUser{ID: uid})
	}
	for _, binding := range []identityBinding{{UserID: 1, ProviderID: 1, ProviderUserID: "Subject"}, {UserID: 2, ProviderID: 1, ProviderUserID: "subject"}, {UserID: 3, ProviderID: 2, ProviderUserID: "Subject"}} {
		db.Create(&binding)
	}
	for uid := 1; uid <= 3; uid++ {
		if err := EnsureManagedAccount(db, uid, now); err != nil {
			t.Fatal(err)
		}
		var grant TrialGrant
		db.First(&grant, uid)
		if grant.Limit != 20 {
			t.Fatal(grant)
		}
	}
	if err := RecordTrialOAuthIdentity(db, 1, 2, "later", now); err != nil {
		t.Fatal(err)
	}
	db.Create(&identityBinding{UserID: 4, ProviderID: 2, ProviderUserID: "later"})
	if err := EnsureManagedAccount(db, 4, now); err != nil {
		t.Fatal(err)
	}
	var grant TrialGrant
	db.First(&grant, 4)
	if grant.Limit != 0 {
		t.Fatal(grant)
	}
	// Binding an already-claimed identity never transfers claims or resets a grant.
	if err := RecordTrialOAuthIdentity(db, 1, 1, "subject", now); err != nil {
		t.Fatal(err)
	}
	if err := EnsureManagedAccount(db, 1, now.Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	grant = TrialGrant{}
	db.First(&grant, 1)
	if grant.Limit != 20 {
		t.Fatal(grant)
	}
	db.Where("id = ?", 1).Delete(&identityUser{})
	db.Where("user_id = ?", 1).Delete(&identityBinding{})
	db.Create(&identityUser{ID: 5})
	db.Create(&identityBinding{UserID: 5, ProviderID: 1, ProviderUserID: "Subject"})
	if err := EnsureManagedAccount(db, 5, now); err != nil {
		t.Fatal(err)
	}
	var reused TrialGrant
	db.First(&reused, 5)
	if reused.Limit != 0 {
		t.Fatal(reused)
	}
}
func TestTrialIdentityConcurrentRegrantAndFailClosed(t *testing.T) {
	db := identityFixture(t)
	now := time.Now()
	for uid := 1; uid <= 8; uid++ {
		db.Create(&identityUser{ID: uid, Email: "same@example.test"})
	}
	var wg sync.WaitGroup
	var grants atomic.Int32
	for uid := 1; uid <= 8; uid++ {
		wg.Add(1)
		go func(uid int) {
			defer wg.Done()
			if err := RecordVerifiedTrialEmail(db, uid, "same@example.test", now); err != nil {
				t.Error(err)
				return
			}
			if err := EnsureManagedAccount(db, uid, now); err != nil {
				t.Error(err)
				return
			}
			var g TrialGrant
			db.First(&g, uid)
			if g.Limit == 20 {
				grants.Add(1)
			}
		}(uid)
	}
	wg.Wait()
	if grants.Load() != 1 {
		t.Fatalf("granted %d", grants.Load())
	}
	db.Migrator().DropTable(&identityBinding{})
	if err := EnsureManagedAccount(db, 1, now); err == nil {
		t.Fatal("missing production identity table bypassed")
	}
}
func TestTrialIdentityUnverifiedEmailAndUnknownUserGetNoGrant(t *testing.T) {
	db := identityFixture(t)
	now := time.Now()
	db.Create(&identityUser{ID: 1, Email: "unverified@example.test"})
	if err := EnsureManagedAccount(db, 1, now); err != nil {
		t.Fatal(err)
	}
	var g TrialGrant
	db.First(&g, 1)
	if g.Limit != 0 {
		t.Fatal(g)
	}
	if err := EnsureManagedAccount(db, 999, now); !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatal(fmt.Sprint(err))
	}
}

func TestTrialIdentityMySQLExistingSnapshotReadsCurrentClaim(t *testing.T) {
	db := identityFixture(t)
	if db.Dialector.Name() != "mysql" {
		t.Skip("requires MySQL REPEATABLE READ")
	}
	now := time.Now()
	db.Create(&identityUser{ID: 1, Email: "snapshot@example.test"})
	db.Create(&identityUser{ID: 2, Email: "snapshot@example.test"})
	stale := db.Begin()
	if stale.Error != nil {
		t.Fatal(stale.Error)
	}
	defer stale.Rollback()
	var count int64
	if err := stale.Model(&TrialIdentityClaim{}).Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if err := RecordVerifiedTrialEmail(db, 1, "snapshot@example.test", now); err != nil {
		t.Fatal(err)
	}
	if err := RecordVerifiedTrialEmail(stale, 2, "snapshot@example.test", now); err != nil {
		t.Fatal("stale outer transaction must read current claim:", err)
	}
	if err := EnsureManagedAccount(stale, 2, now); err != nil {
		t.Fatal(err)
	}
	if err := stale.Commit().Error; err != nil {
		t.Fatal(err)
	}
	var grant TrialGrant
	if err := db.First(&grant, 2).Error; err != nil || grant.Limit != 0 {
		t.Fatal(grant, err)
	}
}

func TestTrialIdentityMissingEmailColumnFailsClosed(t *testing.T) {
	db := identityFixture(t)
	if err := db.Create(&identityUser{ID: 1}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Migrator().DropColumn(&identityUser{}, "Email"); err != nil {
		t.Fatal(err)
	}
	if err := EnsureManagedAccount(db, 1, time.Now()); err == nil {
		t.Fatal("missing email column silently bypassed identity verification")
	}
}
