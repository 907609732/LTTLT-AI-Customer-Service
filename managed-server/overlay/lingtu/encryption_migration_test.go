package lingtu

import (
	"bytes"
	"strings"
	"testing"
)

type legacyChannel struct {
	ID  int `gorm:"primaryKey"`
	Key string
}

func (legacyChannel) TableName() string { return "channels" }

type legacyOption struct {
	Key   string `gorm:"primaryKey"`
	Value string
}

func (legacyOption) TableName() string { return "options" }

type legacyProvider struct {
	ID           int    `gorm:"primaryKey"`
	ClientSecret string `gorm:"type:text"`
}

func (legacyProvider) TableName() string { return "custom_oauth_providers" }

func TestLingtuLegacyEncryptionPreservesValuesAndRunsOnlyOnce(t *testing.T) {
	db := trialDB(t)
	v, _ := NewVault(bytes.Repeat([]byte{31}, 32))
	SetEncryptionVault(v)
	if err := db.Migrator().DropTable(&legacyChannel{}, &legacyOption{}, &legacyProvider{}, &encryptionState{}); err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&legacyChannel{}, &legacyOption{}, &legacyProvider{}); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&legacyChannel{ID: 7, Key: "legacy-model-key"}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&legacyOption{Key: "Version", Value: "v1.0.0"}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&legacyProvider{ID: 8, ClientSecret: strings.Repeat("s", 500)}).Error; err != nil {
		t.Fatal(err)
	}
	if err := EncryptLegacyCredentials(db); err != nil {
		t.Fatal(err)
	}
	var channel legacyChannel
	db.First(&channel, 7)
	if channel.Key == "legacy-model-key" {
		t.Fatal("legacy key stayed plaintext")
	}
	plain, err := v.Open("channels.key", channel.Key)
	if err != nil || string(plain) != "legacy-model-key" {
		t.Fatal(err)
	}
	before := channel.Key
	if err = EncryptLegacyCredentials(db); err != nil {
		t.Fatal(err)
	}
	db.First(&channel, 7)
	if channel.Key != before {
		t.Fatal("migration encrypted a row twice")
	}
	var option legacyOption
	db.Where(map[string]any{"key": "Version"}).First(&option)
	plain, err = v.Open("options.value", option.Value)
	if err != nil || string(plain) != "v1.0.0" {
		t.Fatal("version-like plaintext was mistaken for ciphertext")
	}
	var provider legacyProvider
	db.First(&provider, 8)
	plain, err = v.Open("custom_oauth_providers.client_secret", provider.ClientSecret)
	if err != nil || string(plain) != strings.Repeat("s", 500) {
		t.Fatal("long OAuth secret changed")
	}
}
