package lingtu

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"strings"
)

type Vault struct {
	aead cipher.AEAD
	key  []byte
}

func NewVault(key []byte) (*Vault, error) {
	if len(key) != 32 {
		return nil, errors.New("managed credential master key must contain 32 bytes")
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	return &Vault{aead: aead, key: append([]byte(nil), key...)}, nil
}
func (v *Vault) Seal(context string, plain []byte) (string, error) {
	nonce := make([]byte, v.aead.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", err
	}
	sealed := v.aead.Seal(nonce, nonce, plain, []byte("lingtu/v1/"+context))
	return "v1." + base64.RawURLEncoding.EncodeToString(sealed), nil
}
func (v *Vault) Open(context, sealed string) ([]byte, error) {
	invalid := errors.New("invalid encrypted managed credential")
	if !strings.HasPrefix(sealed, "v1.") {
		return nil, invalid
	}
	raw, err := base64.RawURLEncoding.DecodeString(strings.TrimPrefix(sealed, "v1."))
	if err != nil || len(raw) < v.aead.NonceSize()+v.aead.Overhead() {
		return nil, invalid
	}
	plain, err := v.aead.Open(nil, raw[:v.aead.NonceSize()], raw[v.aead.NonceSize():], []byte("lingtu/v1/"+context))
	if err != nil {
		return nil, invalid
	}
	return plain, nil
}
func (v *Vault) derive(purpose string) []byte {
	mac := hmac.New(sha256.New, v.key)
	mac.Write([]byte("lingtu/" + purpose + "/v1"))
	return mac.Sum(nil)
}
func (v *Vault) digest(purpose, value string) string {
	mac := hmac.New(sha256.New, v.derive(purpose))
	mac.Write([]byte(value))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}
func randomSecret() (string, error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(raw), nil
}
