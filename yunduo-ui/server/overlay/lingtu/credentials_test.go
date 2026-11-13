package lingtu

import (
	"bytes"
	"strings"
	"testing"
)

func TestCredentialEncryptionRejectsTamperingAndWrongContext(t *testing.T) {
	key := bytes.Repeat([]byte{7}, 32)
	vault, err := NewVault(key)
	if err != nil {
		t.Fatal(err)
	}
	sealed, err := vault.Seal("provider:deepseek", []byte("secret-fixture"))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(sealed, "secret-fixture") {
		t.Fatal("plaintext credential leaked")
	}
	plain, err := vault.Open("provider:deepseek", sealed)
	if err != nil || string(plain) != "secret-fixture" {
		t.Fatal(err)
	}
	if _, err = vault.Open("provider:qwen", sealed); err == nil {
		t.Fatal("ciphertext moved to another credential")
	}
	other, _ := NewVault(bytes.Repeat([]byte{8}, 32))
	if _, err = other.Open("provider:deepseek", sealed); err == nil {
		t.Fatal("wrong key accepted")
	}
	for _, bad := range []string{"", sealed[:12], "v2." + sealed[3:], sealed[:len(sealed)-5] + "AAAAA"} {
		if _, err = vault.Open("provider:deepseek", bad); err == nil {
			t.Fatal("damaged ciphertext accepted")
		}
	}
}
