package lingtu

import (
	"fmt"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestRechargeExtendsUnexpiredTrial(t *testing.T) {
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
	if trial.Limit != 2 || trial.ExpiresAt != now.Add(365*24*time.Hour).Unix() {
		t.Fatalf("recharge did not preserve and extend trial: %+v", trial)
	}
	q, err := store.Quota(1, now.Add(2*time.Hour))
	if err != nil || q.Remaining != 7 || q.Trial.Remaining != 2 {
		t.Fatalf("trial expired after recharge: %+v %v", q, err)
	}
}

func TestRechargeTrialExpiryBoundaries(t *testing.T) {
	for _, tc := range []struct {
		name      string
		expiresIn time.Duration
	}{
		{"active", time.Hour}, {"expired", -time.Hour},
		{"at_expiry", 0}, {"longer_trial", 400 * 24 * time.Hour},
	} {
		t.Run(tc.name, func(t *testing.T) {
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
			originalExpiry := now.Add(tc.expiresIn).Unix()
			grant := TrialGrant{UserID: 1, Limit: 10, Used: 2, Reserved: 1, CreatedAt: now.Add(-time.Hour).Unix(), ExpiresAt: originalExpiry}
			if err := db.Create(&grant).Error; err != nil {
				t.Fatal(err)
			}
			credit := func(id string, at time.Time, event string) (BillingOrder, BillingPayment) {
				t.Helper()
				o, err := store.CreateChannelOrder(1, id, BillingPlan{ID: "p", Name: "p", Currency: "cny", Amount: 100, Calls: 5, ValidDays: 365}, "alipay", at)
				if err != nil {
					t.Fatal(err)
				}
				p := BillingPayment{OrderID: o.ID, Channel: "alipay", MerchantID: "m", TransactionID: id, EventID: event, Currency: "cny", Amount: 100, PaidAt: at.Unix()}
				if err := store.Credit(p, at); err != nil {
					t.Fatal(err)
				}
				return o, p
			}
			_, payment := credit("first", now, "first")
			// A delayed duplicate must not renew either pool a second time.
			if err := store.Credit(payment, now.Add(24*time.Hour)); err != nil {
				t.Fatal(err)
			}
			var actual TrialGrant
			if err := db.First(&actual, "user_id = ?", 1).Error; err != nil {
				t.Fatal(err)
			}
			expectedExpiry := originalExpiry
			if tc.expiresIn > 0 {
				expectedExpiry = max(originalExpiry, now.Add(365*24*time.Hour).Unix())
			}
			if actual.ExpiresAt != expectedExpiry || actual.Limit != 10 || actual.Used != 2 || actual.Reserved != 1 {
				t.Fatalf("trial changed incorrectly: %+v", actual)
			}
			credit("second", now.Add(24*time.Hour), "second")
			q, err := store.Quota(1, now.Add(24*time.Hour))
			if err != nil || q.Paid.Remaining != 10 {
				t.Fatalf("renewal: %+v %v", q, err)
			}
			if tc.expiresIn > 0 {
				if q.Trial.Remaining != 7 || q.Trial.ExpiresAt != max(originalExpiry, now.Add(366*24*time.Hour).Unix()) {
					t.Fatalf("active trial not renewed: %+v", q)
				}
			} else if q.Trial.Remaining != 0 || q.Trial.ExpiresAt != originalExpiry {
				t.Fatalf("expired trial revived: %+v", q)
			}
		})
	}
}

func TestRechargeTrialExtensionRollsBackWithCredit(t *testing.T) {
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
	if err := trials.Grant(1, now, 3, time.Hour); err != nil {
		t.Fatal(err)
	}
	if _, err := trials.Reserve(1, "inflight", "d", now); err != nil {
		t.Fatal(err)
	}
	order, err := store.CreateChannelOrder(1, "rollback", BillingPlan{ID: "p", Name: "p", Currency: "cny", Amount: 100, Calls: 5, ValidDays: 365}, "wechat", now)
	if err != nil {
		t.Fatal(err)
	}
	// A receipt conflict happens after both entitlement writes and must roll them back.
	if err := db.Create(&BillingCredit{OrderID: "other", EventID: "duplicate", UserID: 2, Calls: 5}).Error; err != nil {
		t.Fatal(err)
	}
	payment := BillingPayment{OrderID: order.ID, Channel: "wechat", MerchantID: "m", TransactionID: "t", EventID: "duplicate", Currency: "cny", Amount: 100, PaidAt: now.Unix()}
	if err := store.Credit(payment, now); err == nil {
		t.Fatal("expected receipt conflict")
	}
	q, err := store.Quota(1, now)
	if err != nil || q.Trial.ExpiresAt != now.Add(time.Hour).Unix() || q.Trial.Reserved != 1 || q.Paid.Limit != 0 {
		t.Fatalf("partial credit: %+v %v", q, err)
	}
	stored, err := store.Order(1, order.ID)
	if err != nil || stored.State != "pending" {
		t.Fatalf("order not rolled back: %+v %v", stored, err)
	}
	payment.EventID = "valid"
	if err := store.Credit(payment, now); err != nil {
		t.Fatal(err)
	}
	if err := trials.Settle(1, "inflight", "success"); err != nil {
		t.Fatal(err)
	}
	q, err = store.Quota(1, now.Add(2*time.Hour))
	if err != nil || q.Trial.Used != 1 || q.Trial.Reserved != 0 || q.Remaining != 7 {
		t.Fatalf("inflight settlement: %+v %v", q, err)
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

func TestPermanentSupportQuotaRetainsOriginalOrderTermsAndSettlement(t *testing.T) {
	db := trialDB(t)
	trials, billing := NewTrialStore(db), NewBillingStore(db)
	if err := trials.Migrate(); err != nil {
		t.Fatal(err)
	}
	if err := billing.Migrate(); err != nil {
		t.Fatal(err)
	}
	now := time.Unix(1800000000, 0)
	if err := trials.Grant(42, now, 1, time.Hour); err != nil {
		t.Fatal(err)
	}

	plan := BillingPlan{ID: "support_100000", Name: "Support", Currency: "cny", Amount: 100000, Calls: 100000, ValidDays: 365}
	legacy, err := billing.CreateOrder(42, "legacy", plan, now)
	if err != nil {
		t.Fatal(err)
	}
	plan.Permanent = true
	retry, err := billing.CreateOrder(42, "legacy", plan, now)
	if err != nil || retry.ID != legacy.ID || retry.Plan.Permanent {
		t.Fatalf("legacy retry changed terms: %+v %v", retry, err)
	}
	order, err := billing.CreateOrder(42, "new", plan, now)
	if err != nil || !order.Plan.Permanent {
		t.Fatalf("new terms missing: %+v %v", order, err)
	}

	pay := func(o BillingOrder, event string) {
		t.Helper()
		session := "cs_" + event
		if err := billing.AttachCheckout(o.ID, session); err != nil {
			t.Fatal(err)
		}
		payment := BillingPayment{OrderID: o.ID, SessionID: session, EventID: event, Amount: plan.Amount, Currency: plan.Currency}
		for range 2 {
			if err := billing.Credit(payment, now); err != nil {
				t.Fatal(err)
			}
		}
	}
	pay(order, "permanent")
	q, err := billing.Quota(42, now)
	if err != nil || q.Permanent.Remaining != 100000 || q.Paid.Limit != 0 || q.Trial.ExpiresAt != now.Add(365*24*time.Hour).Unix() {
		t.Fatalf("permanent purchase affected timed paid quota or trial extension: %+v %v", q, err)
	}
	duplicate, err := billing.CreateOrder(42, "duplicate_event", plan, now)
	if err != nil {
		t.Fatal(err)
	}
	if err := billing.AttachCheckout(duplicate.ID, "cs_duplicate"); err != nil {
		t.Fatal(err)
	}
	if err := billing.Credit(BillingPayment{OrderID: duplicate.ID, SessionID: "cs_duplicate", EventID: "permanent", Amount: plan.Amount, Currency: plan.Currency}, now); err == nil {
		t.Fatal("duplicate event credited another order")
	}
	duplicate, err = billing.Order(42, duplicate.ID)
	if err != nil || duplicate.State != "pending" {
		t.Fatalf("failed credit changed order: %+v %v", duplicate, err)
	}
	pay(legacy, "legacy")
	q, err = billing.Quota(42, now)
	if err != nil || q.Paid.Remaining != 100000 || q.Permanent.Remaining != 100000 {
		t.Fatalf("legacy purchase changed pools: %+v %v", q, err)
	}

	reserve := func(id string, at time.Time, source string) {
		t.Helper()
		if _, err := trials.Reserve(42, id, "digest_"+id, at); err != nil {
			t.Fatal(err)
		}
		var request TrialRequest
		if err := db.First(&request, "user_id = ? AND request_id = ?", 42, id).Error; err != nil || request.Source != source {
			t.Fatalf("reservation source: %+v %v", request, err)
		}
	}
	reserve("trial", now, "trial")
	reserve("paid", now, "paid")
	later := now.Add(2 * 365 * 24 * time.Hour)
	reserve("success", later, "permanent")
	reserve("uncertain", later, "permanent")
	if err := trials.Settle(42, "success", "success"); err != nil {
		t.Fatal(err)
	}
	if err := trials.Settle(42, "uncertain", "uncertain"); err != nil {
		t.Fatal(err)
	}
	q, err = billing.Quota(42, later)
	if err != nil || q.Permanent.Reserved != 1 || q.Permanent.Used != 1 || q.Remaining != 99998 || q.Trial.Remaining != 0 || q.Paid.Remaining != 0 {
		t.Fatalf("incorrect quota after expiry and settlement: %+v %v", q, err)
	}
	if err := trials.Settle(42, "uncertain", "failed"); err != nil {
		t.Fatal(err)
	}
	q, err = billing.Quota(42, later)
	if err != nil || q.Permanent.Reserved != 0 || q.Remaining != 99999 || q.AccountQuota().ExpiresAt != PermanentAccountExpiry {
		t.Fatalf("reconciliation or account compatibility failed: %+v %v", q, err)
	}
}
