package lingtu

import (
	"fmt"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestRechargeLeavesTrialIndependent(t *testing.T) {
	db := trialDB(t)
	trials := NewTrialStore(db)
	if err := trials.Migrate(); err != nil {
		t.Fatal(err)
	}
	store := NewBillingStore(db)
	if err := store.Migrate(); err != nil {
		t.Fatal(err)
	}
	now := time.Unix(1800000000, 0)
	trials.Grant(1, now, 2, time.Hour)
	order, err := store.CreateOrder(1, "independent", BillingPlan{ID: "p", Name: "p", Currency: "cny", Amount: 100, Calls: 5, ValidDays: 365}, now)
	if err != nil {
		t.Fatal(err)
	}
	store.AttachCheckout(order.ID, "cs")
	if err = store.Credit(BillingPayment{OrderID: order.ID, SessionID: "cs", EventID: "evt", Amount: 100, Currency: "cny"}, now); err != nil {
		t.Fatal(err)
	}
	var trial TrialGrant
	db.First(&trial, "user_id = ?", 1)
	if trial.Limit != 2 || trial.ExpiresAt != now.Add(time.Hour).Unix() {
		t.Fatalf("recharge changed trial: %+v", trial)
	}
}

func TestPaidQuotaRenewalAndSourceSettlement(t *testing.T) {
	db := trialDB(t)
	s := NewTrialStore(db)
	if e := s.Migrate(); e != nil {
		t.Fatal(e)
	}
	b := NewBillingStore(db)
	if e := b.Migrate(); e != nil {
		t.Fatal(e)
	}
	now := time.Unix(1800000000, 0)
	s.Grant(3, now, 1, time.Hour)
	credit := func(id string, at time.Time) {
		t.Helper()
		o, e := b.CreateChannelOrder(3, id, BillingPlan{ID: "p", Name: "p", Currency: "cny", Amount: 990, Calls: 3, ValidDays: 365}, "alipay", at)
		if e != nil {
			t.Fatal(e)
		}
		if e = b.Credit(BillingPayment{OrderID: o.ID, Channel: "alipay", MerchantID: "m", TransactionID: id, EventID: id, Currency: "cny", Amount: 990, PaidAt: at.Add(-time.Minute).Unix()}, at); e != nil {
			t.Fatal(e)
		}
	}
	credit("one", now)
	if _, e := s.Reserve(3, "trial", "d", now); e != nil {
		t.Fatal(e)
	}
	s.Settle(3, "trial", "success")
	s.Reserve(3, "paid", "d", now)
	s.Settle(3, "paid", "uncertain")
	q, e := b.Quota(3, now)
	if e != nil || q.Trial.Used != 1 || q.Paid.Reserved != 1 || q.Remaining != 2 {
		t.Fatalf("sources %+v %v", q, e)
	}
	s.Settle(3, "paid", "failed")
	credit("two", now.Add(24*time.Hour))
	q, _ = b.Quota(3, now.Add(24*time.Hour))
	if q.Paid.Remaining != 6 || q.Paid.ExpiresAt != now.Add(366*24*time.Hour).Unix() || q.Trial.Remaining != 0 {
		t.Fatalf("renewal %+v", q)
	}
	late := now.Add(367 * 24 * time.Hour)
	credit("three", late)
	q, _ = b.Quota(3, late)
	if q.Paid.Remaining != 3 {
		t.Fatalf("expired revived %+v", q)
	}
	s.Reserve(3, "summary", "d", late)
	if e = s.SettleAuxiliary(3, "summary", "success"); e != nil {
		t.Fatal(e)
	}
	q, _ = b.Quota(3, late)
	if q.Paid.Remaining != 3 || q.Paid.Reserved != 0 {
		t.Fatalf("summary charged %+v", q)
	}
}
func TestNativePaymentUniquenessAndCloseRace(t *testing.T) {
	db := trialDB(t)
	s := NewTrialStore(db)
	s.Migrate()
	b := NewBillingStore(db)
	b.Migrate()
	now := time.Unix(1800000000, 0)
	plan := BillingPlan{ID: "p", Name: "p", Currency: "cny", Amount: 100, Calls: 3, ValidDays: 365}
	a, _ := b.CreateChannelOrder(1, "a", plan, "wechat", now)
	c, _ := b.CreateChannelOrder(1, "b", plan, "wechat", now)
	b.CloseOrder(1, a.ID)
	p := BillingPayment{OrderID: a.ID, Channel: "wechat", MerchantID: "m", TransactionID: "txn", EventID: "evt", Currency: "cny", Amount: 100, PaidAt: now.Add(-time.Hour).Unix()}
	if e := b.Credit(p, now); e != nil {
		t.Fatal(e)
	}
	o, _ := b.CloseOrder(1, a.ID)
	if o.State != "paid" || o.CreditedAt != now.Unix() || o.PaidAt != p.PaidAt {
		t.Fatalf("timestamps/state %+v", o)
	}
	p.OrderID = c.ID
	p.EventID = "other"
	if e := b.Credit(p, now); e == nil {
		t.Fatal("transaction credited twice")
	}
	q, _ := b.Quota(1, now)
	if q.Paid.Limit != 3 {
		t.Fatalf("duplicate leaked %+v", q)
	}
}
func TestLegacyMixedGrantRequiresReceiptEvidence(t *testing.T) {
	db := trialDB(t)
	s := NewTrialStore(db)
	s.Migrate()
	b := NewBillingStore(db)
	b.Migrate()
	now := time.Unix(1800000000, 0)
	s.Grant(1, now, 12, time.Hour)
	s.Grant(2, now, 12, time.Hour)
	db.Create(&BillingCredit{OrderID: "old", EventID: "old_evt", UserID: 1, Calls: 10, CreatedAt: now.Unix()})
	if e := b.Migrate(); e != nil {
		t.Fatal(e)
	}
	q, e := b.Quota(1, now)
	if e != nil || q.Trial.Limit != 12 || q.Trial.Provenance != "legacy_mixed" || q.Paid.Limit != 0 {
		t.Fatalf("legacy %+v %v", q, e)
	}
	q, _ = b.Quota(2, now)
	if q.Trial.Provenance != "" {
		t.Fatalf("guessed receipt %+v", q)
	}
}
func TestExpiredPaidReservationFailureDoesNotReviveAfterRecharge(t *testing.T) {
	db := trialDB(t)
	s := NewTrialStore(db)
	s.Migrate()
	b := NewBillingStore(db)
	b.Migrate()
	now := time.Unix(1800000000, 0)
	credit := func(id string, at time.Time) {
		o, _ := b.CreateOrder(1, id, BillingPlan{ID: "p", Name: "p", Currency: "cny", Amount: 100, Calls: 2, ValidDays: 365}, at)
		b.AttachCheckout(o.ID, id)
		if e := b.Credit(BillingPayment{OrderID: o.ID, SessionID: id, EventID: id, Amount: 100, Currency: "cny"}, at); e != nil {
			t.Fatal(e)
		}
	}
	credit("one", now)
	s.Reserve(1, "inflight", "d", now)
	late := now.Add(366 * 24 * time.Hour)
	credit("two", late)
	if e := s.Settle(1, "inflight", "failed"); e != nil {
		t.Fatal(e)
	}
	q, _ := b.Quota(1, late)
	if q.Paid.Remaining != 2 {
		t.Fatalf("expired held call revived %+v", q)
	}
}

func TestMixedQuotaConcurrentReservationsNeverOverspend(t *testing.T) {
	db := trialDB(t)
	s := NewTrialStore(db)
	s.Migrate()
	b := NewBillingStore(db)
	b.Migrate()
	now := time.Unix(1800000000, 0)
	s.Grant(1, now, 2, time.Hour)
	o, _ := b.CreateOrder(1, "pay", BillingPlan{ID: "p", Name: "p", Currency: "cny", Amount: 100, Calls: 4, ValidDays: 365}, now)
	b.AttachCheckout(o.ID, "cs")
	if e := b.Credit(BillingPayment{OrderID: o.ID, SessionID: "cs", EventID: "evt", Amount: 100, Currency: "cny"}, now); e != nil {
		t.Fatal(e)
	}
	var wg sync.WaitGroup
	var count atomic.Int32
	for i := range 24 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if r, e := s.Reserve(1, fmt.Sprint(i), "d", now); e == nil && r.Created {
				count.Add(1)
			}
		}()
	}
	wg.Wait()
	q, e := b.Quota(1, now)
	if e != nil || count.Load() != 6 || q.Trial.Reserved != 2 || q.Paid.Reserved != 4 || q.Remaining != 0 {
		t.Fatalf("overspend count=%d quota=%+v error=%v", count.Load(), q, e)
	}
}
func TestAuxiliaryUnknownReconciliationRemainsFree(t *testing.T) {
	db := trialDB(t)
	s := NewTrialStore(db)
	s.Migrate()
	now := time.Unix(1800000000, 0)
	s.Grant(1, now, 2, time.Hour)
	s.Reserve(1, "summary", "d", now)
	if e := s.MarkAuxiliary(1, "summary"); e != nil {
		t.Fatal(e)
	}
	s.SettleAuxiliary(1, "summary", "uncertain")
	if e := s.Settle(1, "summary", "success"); e != nil {
		t.Fatal(e)
	}
	var g TrialGrant
	db.First(&g, "user_id = ?", 1)
	if g.Used != 0 || g.Reserved != 0 {
		t.Fatalf("summary reconciliation billed %+v", g)
	}
}
