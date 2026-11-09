package service

import (
	"encoding/hex"
	"encoding/json"

	"github.com/QuantumNous/new-api/common"
)

const VerificationScopeManagedConfigure = "admin.user.managed_config"

type ManagedConfigurationContext struct {
	Section     string `json:"section"`
	RequestHash string `json:"request_hash"`
}

func bindManagedConfiguration(fields map[string]json.RawMessage) (ManagedConfigurationContext, error) {
	var context ManagedConfigurationContext
	if len(fields) != 2 || common.Unmarshal(fields["section"], &context.Section) != nil || common.Unmarshal(fields["request_hash"], &context.RequestHash) != nil || len(context.RequestHash) != 64 {
		return context, ErrVerificationContextInvalid
	}
	if _, err := hex.DecodeString(context.RequestHash); err != nil {
		return context, ErrVerificationContextInvalid
	}
	switch context.Section {
	case "wechat", "dingtalk", "deepseek", "qwen", "smtp", "trial", "account", "reconcile":
		return context, nil
	}
	return context, ErrVerificationContextInvalid
}
