package service

import (
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
)

func TestLingtuConnectionProofSupportsExactManagedSectionAndBody(t *testing.T) {
	for _, section := range []string{"model_connection", "qwen-vision"} {
		context, _ := common.Marshal(map[string]string{"section": section, "request_hash": strings.Repeat("b", 64)})
		first, err := BindVerificationOperation(VerificationOperation{Scope: VerificationScopeManagedConfigure, Context: context})
		if err != nil {
			t.Fatal("authorized managed section rejected", section, err)
		}
		context, _ = common.Marshal(map[string]string{"section": section, "request_hash": strings.Repeat("c", 64)})
		second, err := BindVerificationOperation(VerificationOperation{Scope: VerificationScopeManagedConfigure, Context: context})
		if err != nil || first.ContextHash == second.ContextHash {
			t.Fatal("proof not bound to exact body")
		}
	}
}

func TestLingtuConfigurationProofBindsExactSectionAndRequest(t *testing.T) {
	context, _ := common.Marshal(map[string]string{"section": "wechat", "request_hash": strings.Repeat("a", 64)})
	first, err := BindVerificationOperation(VerificationOperation{Scope: "admin.user.managed_config", Context: context})
	if err != nil {
		t.Fatal(err)
	}
	context, _ = common.Marshal(map[string]string{"section": "dingtalk", "request_hash": strings.Repeat("a", 64)})
	second, err := BindVerificationOperation(VerificationOperation{Scope: "admin.user.managed_config", Context: context})
	if err != nil || first.ContextHash == second.ContextHash {
		t.Fatal("configuration proof not bound to section")
	}
	for _, bad := range []string{`{}`, `{"section":"wechat","request_hash":"x"}`, `{"section":"unknown","request_hash":"` + strings.Repeat("a", 64) + `"}`, `{"section":"wechat","request_hash":"` + strings.Repeat("a", 64) + `","extra":true}`} {
		if _, err := BindVerificationOperation(VerificationOperation{Scope: "admin.user.managed_config", Context: []byte(bad)}); err == nil {
			t.Fatal("invalid operation accepted")
		}
	}
}
