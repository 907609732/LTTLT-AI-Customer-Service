package lingtuhost

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/lingtu"
	"github.com/QuantumNous/new-api/model"
	"gorm.io/gorm"
)

const (
	maxBatchTargets          = 20
	maxBatchQuotaCalls       = 1000000
	maxBatchQuotaReasonBytes = 180
)

// ErrBatchQuotaConflict distinguishes a stale expected_limit from malformed
// input. The handler returns 409 so the administrator refreshes instead of
// retrying an absolute target against a ledger that changed underneath.
var ErrBatchQuotaConflict = errors.New("batch quota conflict")

type batchTarget struct {
	UserID        int `json:"user_id"`
	ExpectedLimit int `json:"expected_limit"`
	TargetCalls   int `json:"target_calls"`
}

type batchQuotaRequest struct {
	Reason  string        `json:"reason"`
	Targets []batchTarget `json:"targets"`
}

// decodeBatchQuotaRequest applies an exact field whitelist before the security
// proof is checked. The proof still covers the entire original body, so every
// target, expected value and reason byte is bound to the administrator action.
func decodeBatchQuotaRequest(body []byte) (batchQuotaRequest, error) {
	var request batchQuotaRequest
	var fields map[string]json.RawMessage
	if common.Unmarshal(body, &fields) != nil || len(fields) != 4 {
		return request, lingtu.ErrInvalidTrialInput
	}
	for _, key := range []string{"section", "action", "reason", "targets"} {
		if _, ok := fields[key]; !ok {
			return request, lingtu.ErrInvalidTrialInput
		}
	}
	var section, action string
	if common.Unmarshal(fields["section"], &section) != nil || section != "account" ||
		common.Unmarshal(fields["action"], &action) != nil || action != "batch_quota" {
		return request, lingtu.ErrInvalidTrialInput
	}
	var reason *string
	if common.Unmarshal(fields["reason"], &reason) != nil || reason == nil {
		return request, lingtu.ErrInvalidTrialInput
	}
	request.Reason = strings.TrimSpace(*reason)
	if len(request.Reason) < 1 || len(request.Reason) > maxBatchQuotaReasonBytes {
		return request, lingtu.ErrInvalidTrialInput
	}
	var rawTargets []map[string]json.RawMessage
	if common.Unmarshal(fields["targets"], &rawTargets) != nil ||
		len(rawTargets) < 1 || len(rawTargets) > maxBatchTargets {
		return request, lingtu.ErrInvalidTrialInput
	}
	seen := make(map[int]struct{}, len(rawTargets))
	for _, raw := range rawTargets {
		if len(raw) != 3 {
			return request, lingtu.ErrInvalidTrialInput
		}
		var userID, expectedLimit, targetCalls *int
		if common.Unmarshal(raw["user_id"], &userID) != nil || userID == nil ||
			common.Unmarshal(raw["expected_limit"], &expectedLimit) != nil || expectedLimit == nil ||
			common.Unmarshal(raw["target_calls"], &targetCalls) != nil || targetCalls == nil {
			return request, lingtu.ErrInvalidTrialInput
		}
		if *userID <= 0 || *expectedLimit < 0 || *expectedLimit > maxBatchQuotaCalls ||
			*targetCalls < 0 || *targetCalls > maxBatchQuotaCalls {
			return request, lingtu.ErrInvalidTrialInput
		}
		if _, duplicate := seen[*userID]; duplicate {
			return request, lingtu.ErrInvalidTrialInput
		}
		seen[*userID] = struct{}{}
		request.Targets = append(request.Targets, batchTarget{
			UserID: *userID, ExpectedLimit: *expectedLimit, TargetCalls: *targetCalls,
		})
	}
	return request, nil
}

func batchQuotaAuditReason(before, after int, reason string) string {
	prefix := fmt.Sprintf("batch_quota before=%d after=%d; ", before, after)
	remaining := 256 - len(prefix)
	if remaining < 0 {
		remaining = 0
	}
	if len(reason) > remaining {
		reason = reason[:remaining]
	}
	return prefix + reason
}

// saveBatchQuota only changes trial call_limit. It never initializes an account
// or grant, never touches model/status/expiry/sessions, and never adjusts paid or
// permanent ledgers. The shared limit gate plus absolute-target CAS makes the
// whole batch atomic and safe against concurrent Reserve/Settle.
func (h *Host) saveBatchQuota(r configurationRequest, actorID int) error {
	reason := strings.TrimSpace(r.Reason)
	if actorID <= 0 || len(r.Targets) < 1 || len(r.Targets) > maxBatchTargets ||
		len(reason) < 1 || len(reason) > maxBatchQuotaReasonBytes {
		return lingtu.ErrInvalidTrialInput
	}
	return model.DB.Transaction(func(tx *gorm.DB) error {
		if err := lingtu.LockTrialLimits(tx); err != nil {
			return err
		}
		for _, target := range r.Targets {
			if target.UserID <= 0 || target.ExpectedLimit < 0 || target.ExpectedLimit > maxBatchQuotaCalls ||
				target.TargetCalls < 0 || target.TargetCalls > maxBatchQuotaCalls {
				return lingtu.ErrInvalidTrialInput
			}
			var native struct {
				ID     int
				Status int
			}
			err := tx.Table("users").Select("id", "status").Where("id = ? AND deleted_at IS NULL", target.UserID).Take(&native).Error
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return lingtu.ErrInvalidTrialInput
			}
			if err != nil {
				return err
			}
			if native.Status != common.UserStatusEnabled {
				return lingtu.ErrInvalidTrialInput
			}
			var account lingtu.ManagedAccount
			err = tx.First(&account, "user_id = ?", target.UserID).Error
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return lingtu.ErrInvalidTrialInput
			}
			if err != nil {
				return err
			}
			if account.Status != "enabled" {
				return lingtu.ErrInvalidTrialInput
			}
			var grant lingtu.TrialGrant
			err = tx.First(&grant, "user_id = ?", target.UserID).Error
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return lingtu.ErrInvalidTrialInput
			}
			if err != nil {
				return err
			}
			if grant.Limit != target.ExpectedLimit {
				return ErrBatchQuotaConflict
			}
			if target.TargetCalls < grant.Used+grant.Reserved {
				return lingtu.ErrInvalidTrialInput
			}
			before := grant.Limit
			if target.TargetCalls != before {
				result := tx.Model(&lingtu.TrialGrant{}).
					Where("user_id = ? AND call_limit = ? AND used + reserved <= ?", target.UserID, target.ExpectedLimit, target.TargetCalls).
					UpdateColumn("call_limit", target.TargetCalls)
				if result.Error != nil {
					return result.Error
				}
				if result.RowsAffected != 1 {
					return ErrBatchQuotaConflict
				}
			}
			audit := lingtu.ManagedAudit{
				ActorID: actorID, TargetID: target.UserID, Section: "account",
				Outcome: "success", Reason: batchQuotaAuditReason(before, target.TargetCalls, reason),
				CreatedAt: time.Now().Unix(),
			}
			if err := tx.Create(&audit).Error; err != nil {
				return err
			}
		}
		return nil
	})
}
