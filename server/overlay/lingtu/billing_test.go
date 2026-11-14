package lingtu

import (
	"errors"
	"sync"
	"testing"
	"time"
)

func TestBillingPaymentCreditsExactlyOnceAndUsesExistingReservationLedger(t *testing.T) {
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
	if err := trials.Grant(42, now, 2, time.Hour); err != nil {
		t.Fatal(err)
	}
	plan := BillingPlan{ID: "starter", Name: "测试套餐", Currency: "cny", Amount: 1000, Calls: 10, ValidDays: 30}
	order, err := store.CreateOrder(42, "request-1", plan, now)
	if err != nil {
		t.Fatal(err)
	}
	again, err := store.CreateOrder(42, "request-1", plan, now)
	if err != nil || again.ID != order.ID {
		t.Fatalf("retry: %v", err)
	}
	changed := plan
	changed.Calls++
	if _, err := store.CreateOrder(42, "request-1", changed, now); !errors.Is(err, ErrBillingConflict) {
		t.Fatalf("changed order: %v", err)
	}
	if err := store.AttachCheckout(order.ID, "cs_test_1"); err != nil {
		t.Fatal(err)
	}
	payment := BillingPayment{OrderID: order.ID, SessionID: "cs_test_1", EventID: "evt_1", Amount: 1000, Currency: "cny"}
	invalid := payment
	invalid.Amount++
	if err := store.Credit(invalid, now); !errors.Is(err, ErrBillingConflict) {
		t.Fatalf("amount mismatch: %v", err)
	}
	var wg sync.WaitGroup
	for range 8 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if err := store.Credit(payment, now); err != nil {
				t.Error(err)
			}
		}()
	}
	wg.Wait()
	payment.EventID = "evt_2"
	if err := store.Credit(payment, now); err != nil {
		t.Fatal(err)
	}
	var grant TrialGrant
	if err := db.First(&grant, "user_id = ?", 42).Error; err != nil {
		t.Fatal(err)
	}
	if grant.Limit != 12 {
		t.Fatalf("double credit: %+v", grant)
	}
	if _, err := trials.Reserve(42, "model-1", "digest", now); err != nil {
		t.Fatal(err)
	}
	if err := trials.Settle(42, "model-1", "success"); err != nil {
		t.Fatal(err)
	}
	if err := db.First(&grant, "user_id = ?", 42).Error; err != nil {
		t.Fatal(err)
	}
	if grant.Used != 1 || grant.Reserved != 0 {
		t.Fatalf("not connected to consumption: %+v", grant)
	}
	var credits int64
	db.Model(&BillingCredit{}).Count(&credits)
	if credits != 1 {
		t.Fatalf("credit ledger rows: %d", credits)
	}
}

func TestBillingExpiredGrantDoesNotReviveOldUnusedCalls(t *testing.T) {
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
	if err := trials.Grant(7, now.Add(-48*time.Hour), 100, time.Hour); err != nil {
		t.Fatal(err)
	}
	order, err := store.CreateOrder(7, "expired", BillingPlan{ID: "small", Name: "测试", Currency: "cny", Amount: 100, Calls: 5, ValidDays: 1}, now)
	if err != nil {
		t.Fatal(err)
	}
	if err = store.AttachCheckout(order.ID, "cs_expired"); err != nil {
		t.Fatal(err)
	}
	if err = store.Credit(BillingPayment{OrderID: order.ID, SessionID: "cs_expired", EventID: "evt_expired", Currency: "cny", Amount: 100}, now); err != nil {
		t.Fatal(err)
	}
	var grant TrialGrant
	db.First(&grant, "user_id = ?", 7)
	if grant.Limit != 5 || grant.ExpiresAt != now.Add(24*time.Hour).Unix() {
		t.Fatalf("unexpected grant %+v", grant)
	}
	if _, err = store.Orders(8, 0, 20); err != nil {
		t.Fatal(err)
	}
	rows, err := store.Orders(8, 0, 20)
	if err != nil || len(rows) != 0 {
		t.Fatal("cross-account orders exposed")
	}
}

func TestBillingCreditRollsBackGrantWhenReceiptCannotCommit(t *testing.T) {
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
	if err := trials.Grant(42, now, 2, time.Hour); err != nil {
		t.Fatal(err)
	}
	plan := BillingPlan{ID: "p", Name: "测试", Currency: "cny", Amount: 100, Calls: 5, ValidDays: 1}
	for i, request := range []string{"first", "second"} {
		order, err := store.CreateOrder(42, request, plan, now)
		if err != nil {
			t.Fatal(err)
		}
		session := "cs_" + request
		if err = store.AttachCheckout(order.ID, session); err != nil {
			t.Fatal(err)
		}
		err = store.Credit(BillingPayment{OrderID: order.ID, SessionID: session, EventID: "evt_same", Amount: 100, Currency: "cny"}, now)
		if i == 0 && err != nil {
			t.Fatal(err)
		}
		if i == 1 && err == nil {
			t.Fatal("receipt uniqueness conflict accepted")
		}
	}
	var grant TrialGrant
	db.First(&grant, "user_id = ?", 42)
	if grant.Limit != 7 {
		t.Fatalf("failed transaction leaked credit: %+v", grant)
	}
	orders, err := store.Orders(42, 0, 20)
	if err != nil {
		t.Fatal(err)
	}
	paid := 0
	for _, order := range orders {
		if order.State == "paid" {
			paid++
		}
	}
	if paid != 1 {
		t.Fatalf("unexpected paid count %d", paid)
	}
}
