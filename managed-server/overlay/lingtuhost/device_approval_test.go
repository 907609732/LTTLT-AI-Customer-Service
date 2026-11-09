package lingtuhost

import (
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/lingtu"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
)

func TestLingtuDeviceApprovalInheritsAuthenticationDeadline(t *testing.T) {
	db := hostDB(t)
	if err := db.AutoMigrate(&model.User{}, &model.UserSession{}); err != nil {
		t.Fatal(err)
	}
	user := model.User{Id: 91, Username: "device-approval", Status: common.UserStatusEnabled, AuthVersion: 1}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(24 * time.Hour).Unix()
	session := model.UserSession{SID: "browser-fixture", UserID: 91, Version: 1, UserAuthVersion: 1, Status: model.UserSessionStatusActive, RefreshHash: "fixture", ExpiresAt: deadline}
	if err := db.Create(&session).Error; err != nil {
		t.Fatal(err)
	}
	identity := service.AuthIdentity{UserID: 91, SessionID: session.SID, SessionVersion: 1, UserAuthVersion: 1}
	got, err := deviceApprovalDeadline(identity)
	if err != nil || got != deadline {
		t.Fatalf("deadline %d, want %d; error %v", got, deadline, err)
	}
	if err = db.Model(&lingtu.ManagedAccount{}).Where("user_id = ?", 91).UpdateColumn("status", "disabled").Error; err != nil {
		t.Fatal(err)
	}
	if _, err = deviceApprovalDeadline(identity); err == nil {
		t.Fatal("disabled account approved")
	}
	if err = db.Model(&lingtu.ManagedAccount{}).Where("user_id = ?", 91).UpdateColumn("status", "enabled").Error; err != nil {
		t.Fatal(err)
	}
	if err = db.Model(&model.UserSession{}).Where("sid = ?", session.SID).UpdateColumn("version", 2).Error; err != nil {
		t.Fatal(err)
	}
	if _, err = deviceApprovalDeadline(identity); err == nil {
		t.Fatal("stale browser session approved")
	}
	if err = db.Model(&model.UserSession{}).Where("sid = ?", session.SID).Updates(map[string]any{"version": 1, "expires_at": time.Now().Add(-time.Second).Unix()}).Error; err != nil {
		t.Fatal(err)
	}
	if _, err = deviceApprovalDeadline(identity); err == nil {
		t.Fatal("expired browser session approved")
	}
}
