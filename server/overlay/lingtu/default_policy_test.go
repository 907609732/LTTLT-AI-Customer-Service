package lingtu

import (
	"bytes"
	"reflect"
	"testing"
	"time"

	"gorm.io/gorm"
)

// policyFixtureDB adds the managed-credential vault because ManagedSetting
// values use the encrypted serializer.
func policyFixtureDB(t *testing.T) *gorm.DB {
	t.Helper()
	vault, err := NewVault(bytes.Repeat([]byte{7}, 32))
	if err != nil {
		t.Fatal(err)
	}
	SetEncryptionVault(vault)
	db := identityFixture(t)
	// MySQL/PostgreSQL share lingtu_test across cases, unlike SQLite's temp
	// database. Only this fixture owns trial_policy; do not leave its encrypted
	// row for the next case to read with another test's encryption vault.
	clearPolicy := func() {
		if err := db.Where("name = ?", "trial_policy").Delete(&ManagedSetting{}).Error; err != nil {
			t.Error(err)
		}
	}
	clearPolicy()
	t.Cleanup(clearPolicy)
	return db
}

// New deployments admit exactly the text model and the visual model the user
// selected. Existing saved policies are covered by the scope tests instead.
func TestTrialDefaultPolicyAdmitsSelectedTextAndVisualModels(t *testing.T) {
	policy := DefaultTrialPolicy()
	if policy.Calls != 100 || policy.DefaultModel != "deepseek-flash" {
		t.Fatal(policy)
	}
	if policy.ModelScope != "selected" || !reflect.DeepEqual(policy.AllowedModels, []string{"deepseek-flash", "qwen3-vl-plus"}) {
		t.Fatal(policy)
	}
}

func TestTrialDefaultPolicyGrantsHundredCalls(t *testing.T) {
	db := identityFixture(t)
	now := time.Now()
	if err := db.Create(&identityUser{ID: 1, Email: "new-account@example.test"}).Error; err != nil {
		t.Fatal(err)
	}
	if err := RecordVerifiedTrialEmail(db, 1, "new-account@example.test", now); err != nil {
		t.Fatal(err)
	}
	if err := EnsureManagedAccount(db, 1, now); err != nil {
		t.Fatal(err)
	}
	var grant TrialGrant
	if err := db.First(&grant, 1).Error; err != nil || grant.Limit != 100 {
		t.Fatal(grant, err)
	}
}

// A row written before model scopes existed must decode on the legacy baseline.
// Decoding it on today's default would silently add a scope and allowed models
// the administrator never saved.
func TestTrialSavedPolicyWithoutScopeKeepsLegacyValues(t *testing.T) {
	db := policyFixtureDB(t)
	if err := db.Save(&ManagedSetting{Name: "trial_policy", Value: `{"calls":20,"days":7,"default_model":"deepseek-flash","daily_calls":200,"max_tokens":512,"per_account_concurrent":1,"requests_per_minute":5,"global_concurrent":4}`}).Error; err != nil {
		t.Fatal(err)
	}
	policy, err := LoadTrialPolicy(db)
	if err != nil {
		t.Fatal(err)
	}
	if policy.Calls != 20 || policy.Days != 7 || policy.DefaultModel != "deepseek-flash" || policy.ModelScope != "" || policy.AllowedModels != nil {
		t.Fatal(policy)
	}
}

// "All enabled models" intentionally omits the allowed list. Loading must not
// fill it from the shipped default, which would make the policy invalid.
func TestTrialSavedAllScopeWithoutAllowedModelsRemainsValid(t *testing.T) {
	db := policyFixtureDB(t)
	if err := db.Save(&ManagedSetting{Name: "trial_policy", Value: `{"calls":20,"days":7,"default_model":"deepseek-flash","model_scope":"all","daily_calls":200,"max_tokens":512,"per_account_concurrent":1,"requests_per_minute":5,"global_concurrent":4}`}).Error; err != nil {
		t.Fatal(err)
	}
	policy, err := LoadTrialPolicy(db)
	if err != nil {
		t.Fatal(err)
	}
	if policy.ModelScope != "all" || policy.AllowedModels != nil {
		t.Fatal(policy)
	}
}

func TestTrialSavedSelectedScopeKeepsOnlySavedModels(t *testing.T) {
	db := policyFixtureDB(t)
	if err := db.Save(&ManagedSetting{Name: "trial_policy", Value: `{"calls":20,"days":7,"default_model":"deepseek-flash","model_scope":"selected","allowed_models":["deepseek-flash"],"daily_calls":200,"max_tokens":512,"per_account_concurrent":1,"requests_per_minute":5,"global_concurrent":4}`}).Error; err != nil {
		t.Fatal(err)
	}
	policy, err := LoadTrialPolicy(db)
	if err != nil {
		t.Fatal(err)
	}
	if policy.ModelScope != "selected" || len(policy.AllowedModels) != 1 || policy.AllowedModels[0] != "deepseek-flash" {
		t.Fatal(policy)
	}
}

func TestTrialNoSavedPolicyUsesShippedDefault(t *testing.T) {
	db := identityFixture(t)
	policy, err := LoadTrialPolicy(db)
	if err != nil {
		t.Fatal(err)
	}
	if policy.Calls != 100 || policy.ModelScope != "selected" || len(policy.AllowedModels) != 2 || policy.AllowedModels[1] != "qwen3-vl-plus" {
		t.Fatal(policy)
	}
}
