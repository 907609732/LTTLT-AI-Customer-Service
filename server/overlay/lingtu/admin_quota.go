package lingtu

import "gorm.io/gorm"

// LockTrialLimits acquires the durable write gate shared by trial reservations,
// settlements and administrator quota changes. Callers must run inside the same
// transaction as the ledger write; the gate is how a batch absolute update
// serializes with Reserve/Settle without losing concurrent counters.
func LockTrialLimits(tx *gorm.DB) error {
	return lockTrialLimits(tx)
}
