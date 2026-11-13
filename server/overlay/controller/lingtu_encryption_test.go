package controller

import (
	"bytes"

	"github.com/QuantumNous/new-api/lingtu"
)

// Test binaries need a stable fixture vault; production must load its private file.
func init() {
	vault, _ := lingtu.NewVault(bytes.Repeat([]byte{19}, 32))
	lingtu.SetEncryptionVault(vault)
}
