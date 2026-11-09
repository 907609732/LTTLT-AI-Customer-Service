package lingtu

import (
	"bytes"
	"strings"
	"testing"
)

type encryptedFixture struct {
	ID  uint
	Key string `gorm:"serializer:lingtu_secret"`
}

func (encryptedFixture) TableName() string { return "lingtu_encryption_fixture" }
func TestGORMSecretsEncryptCreateUpdateAndKeepEmptyOmitSafe(t *testing.T) {
	db := trialDB(t)
	v, _ := NewVault(bytes.Repeat([]byte{3}, 32))
	SetEncryptionVault(v)
	if err := InstallSecretUpdateProtection(db); err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&encryptedFixture{}); err != nil {
		t.Fatal(err)
	}
	fixture := encryptedFixture{Key: "provider-secret"}
	if err := db.Create(&fixture).Error; err != nil {
		t.Fatal(err)
	}
	var raw string
	var quoted strings.Builder
	db.Dialector.QuoteTo(&quoted, "key")
	db.Raw("SELECT "+quoted.String()+" FROM lingtu_encryption_fixture WHERE id = ?", fixture.ID).Scan(&raw)
	if raw == "provider-secret" || raw == "" {
		t.Fatal("key not encrypted")
	}
	var got encryptedFixture
	if err := db.First(&got, fixture.ID).Error; err != nil || got.Key != "provider-secret" {
		t.Fatal(err)
	}
	if err := db.Model(&got).Update("key", "replacement-secret").Error; err != nil {
		t.Fatal(err)
	}
	db.Raw("SELECT "+quoted.String()+" FROM lingtu_encryption_fixture WHERE id = ?", fixture.ID).Scan(&raw)
	if raw == "replacement-secret" {
		t.Fatal("map update stored plaintext")
	}
	if err := db.First(&got, fixture.ID).Error; err != nil || got.Key != "replacement-secret" {
		t.Fatal(err)
	}
	if err := db.Omit("key").First(&encryptedFixture{}, fixture.ID).Error; err != nil {
		t.Fatal(err)
	}
}
