package lingtu

import (
	"errors"
	"testing"
	"time"
)

func TestBillingCheckoutAttachmentRetriesAreIdempotent(t *testing.T) {
	db := trialDB(t)
	store := NewBillingStore(db)
	if err := store.Migrate(); err != nil {
		t.Fatal(err)
	}
	order, err := store.CreateOrder(42, "attachment-retry", BillingPlan{ID: "retry", Name: "test", Currency: "cny", Amount: 100, Calls: 2, ValidDays: 1}, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	for range 2 {
		if err := store.AttachCheckout(order.ID, "same-session"); err != nil {
			t.Fatal(err)
		}
	}
	if err := store.AttachCheckout(order.ID, "different-session"); !errors.Is(err, ErrBillingConflict) {
		t.Fatalf("different reference accepted: %v", err)
	}
	if err := db.Model(&BillingOrder{}).Where("id = ?", order.ID).UpdateColumn("state", "paid").Error; err != nil {
		t.Fatal(err)
	}
	if err := store.AttachCheckout(order.ID, "same-session"); !errors.Is(err, ErrBillingConflict) {
		t.Fatalf("paid order accepted: %v", err)
	}
}
