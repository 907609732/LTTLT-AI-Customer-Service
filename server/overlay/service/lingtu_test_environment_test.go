package service

import (
	"crypto/rand"
	"testing"

	"github.com/QuantumNous/new-api/lingtu"
	"github.com/QuantumNous/new-api/model"
)

// All native service fixtures use the same encrypted channel serializer as the
// managed service. Keep its key ephemeral and independent of production files.
func initializeLingtuServiceTestEncryption() {
	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		panic(err)
	}
	vault, err := lingtu.NewVault(key)
	if err != nil {
		panic(err)
	}
	lingtu.SetEncryptionVault(vault)
}

func TestLingtuServiceTestCredentialsRemainEncrypted(t *testing.T) {
	if _, err := lingtu.RuntimeVault(); err != nil {
		t.Fatalf("native service test setup has no managed credential encryption: %v", err)
	}
	const fixtureKey = "isolated-service-fixture-key"
	channel := model.Channel{Name: "encrypted-service-fixture", Key: fixtureKey}
	if err := model.DB.Create(&channel).Error; err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { model.DB.Unscoped().Delete(&channel) })
	var stored string
	if err := model.DB.Table("channels").Select("key").Where("id = ?", channel.Id).Scan(&stored).Error; err != nil {
		t.Fatal(err)
	}
	if stored == "" || stored == fixtureKey {
		t.Fatal("fixture bypassed credential encryption")
	}
	var loaded model.Channel
	if err := model.DB.First(&loaded, channel.Id).Error; err != nil || loaded.Key != fixtureKey {
		t.Fatal("fixture credential round trip failed", err)
	}
}
