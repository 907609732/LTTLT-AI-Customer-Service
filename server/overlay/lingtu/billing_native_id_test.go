package lingtu

import (
	"testing"
	"time"
)

func TestBillingNativeOrderIDFitsWeChatProtocol(t *testing.T) {
	db := trialDB(t)
	if err := NewTrialStore(db).Migrate(); err != nil {
		t.Fatal(err)
	}
	store := NewBillingStore(db)
	if err := store.Migrate(); err != nil {
		t.Fatal(err)
	}
	plan := BillingPlan{ID: "usage_1000", Name: "experience", Currency: "cny", Amount: 990, Calls: 1000, ValidDays: 365}
	order, err := store.CreateChannelOrder(42, "native-protocol-id", plan, "wechat", time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if len(order.ID) < 6 || len(order.ID) > 32 {
		t.Fatalf("WeChat merchant order ID length must be 6..32, got %d", len(order.ID))
	}
	again, err := store.CreateChannelOrder(42, "native-protocol-id", plan, "wechat", time.Now())
	if err != nil || again.ID != order.ID {
		t.Fatal("stable retry ID lost", err)
	}
}
