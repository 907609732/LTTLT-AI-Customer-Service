package lingtuhost

import (
	"errors"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/lingtu"
	"github.com/QuantumNous/new-api/model"
	"gorm.io/gorm"
)

func managedModelDB(t *testing.T) *gorm.DB {
	t.Helper()
	db := hostDB(t)
	if err := db.Migrator().DropTable(&model.Ability{}, &model.Channel{}); err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.Channel{}, &model.Ability{}); err != nil {
		t.Fatal(err)
	}
	oldMemory := common.MemoryCacheEnabled
	common.MemoryCacheEnabled = true
	t.Cleanup(func() {
		common.MemoryCacheEnabled = false
		model.InitChannelCache()
		common.MemoryCacheEnabled = oldMemory
		db.Migrator().DropTable(&model.Ability{}, &model.Channel{})
	})
	model.InitChannelCache()
	return db
}
func qwenModelFixture() *model.Channel {
	return &model.Channel{Name: "lingtu-qwen", Type: 1, Group: "default", Models: "qwen-plus", Status: common.ChannelStatusEnabled, Key: "fixture-provider-key", TestTime: time.Now().Unix()}
}
func putModelPolicy(t *testing.T, db *gorm.DB) lingtu.TrialPolicy {
	t.Helper()
	policy := lingtu.DefaultTrialPolicy()
	policy.Calls = 37
	policy.Days = 4
	policy.MaxTokens = 777
	policy.DailyCalls = 333
	policy.PerAccountConcurrent = 2
	policy.RequestsPerMinute = 7
	policy.GlobalConcurrent = 6
	value, _ := common.Marshal(policy)
	if err := db.Save(&lingtu.ManagedSetting{Name: "trial_policy", Value: string(value)}).Error; err != nil {
		t.Fatal(err)
	}
	return policy
}
func TestLingtuManagedModelMakeDefaultPreservesPolicyAndGrants(t *testing.T) {
	db := managedModelDB(t)
	before := putModelPolicy(t, db)
	grant := lingtu.TrialGrant{UserID: 19, Limit: 11, Used: 3, Reserved: 1, CreatedAt: 100, ExpiresAt: 200}
	if err := db.Create(&grant).Error; err != nil {
		t.Fatal(err)
	}
	channel := qwenModelFixture()
	if err := persistManagedModel(channel, true); err != nil {
		t.Fatal(err)
	}
	after, err := lingtu.LoadTrialPolicy(db)
	before.DefaultModel = "qwen-plus"
	if err != nil || !reflect.DeepEqual(before, after) {
		t.Fatal(before, after, err)
	}
	var actual lingtu.TrialGrant
	db.First(&actual, 19)
	if !reflect.DeepEqual(grant, actual) {
		t.Fatal(grant, actual)
	}
	var ability model.Ability
	if err := db.Where("channel_id = ?", channel.Id).First(&ability).Error; err != nil || !ability.Enabled || ability.Model != "qwen-plus" {
		t.Fatal(ability, err)
	}
	var raw string
	if err := db.Model(&model.Channel{}).Select("key").Where("id = ?", channel.Id).Row().Scan(&raw); err != nil {
		t.Fatal(err)
	}
	if raw == channel.Key || strings.Contains(raw, "fixture-provider-key") {
		t.Fatal("channel key persisted plaintext")
	}
	cached, err := model.CacheGetChannel(channel.Id)
	if err != nil || cached.Key != channel.Key {
		t.Fatal(cached, err)
	}
}
func TestLingtuManagedModelNoDefaultAndInvalidDefault(t *testing.T) {
	db := managedModelDB(t)
	before := putModelPolicy(t, db)
	channel := qwenModelFixture()
	if err := persistManagedModel(channel, false); err != nil {
		t.Fatal(err)
	}
	after, err := lingtu.LoadTrialPolicy(db)
	if err != nil || !reflect.DeepEqual(before, after) {
		t.Fatal(after, err)
	}
	for _, channel := range []*model.Channel{{Name: "lingtu-qwen", Type: 1, Group: "default", Models: "evil", Status: 1, Key: "key"}, {Name: "lingtu-qwen", Type: 1, Group: "default", Models: "qwen-plus", Status: 2, Key: "key"}, {Name: "lingtu-qwen", Type: 1, Group: "default", Models: "qwen-plus", Status: 1}, {Name: "lingtu-other", Type: 1, Group: "default", Models: "qwen-plus", Status: 1, Key: "key"}} {
		if err := persistManagedModel(channel, true); !errors.Is(err, lingtu.ErrInvalidTrialInput) {
			t.Fatal(channel.Name, err)
		}
	}
}
func TestLingtuManagedModelTransactionRollbackAndCache(t *testing.T) {
	for _, failTable := range []string{"lingtu_settings", "abilities", "channels"} {
		t.Run(failTable, func(t *testing.T) {
			db := managedModelDB(t)
			before := putModelPolicy(t, db)
			channel := qwenModelFixture()
			if err := persistManagedModel(channel, false); err != nil {
				t.Fatal(err)
			}
			originalID := channel.Id
			channel.Key = "replacement-secret"
			checkedCache := false
			reject := func(tx *gorm.DB) {
				if tx.Statement.Schema != nil && tx.Statement.Schema.Table == failTable {
					cached, err := model.CacheGetChannel(originalID)
					if err != nil || cached.Key != "fixture-provider-key" {
						t.Error("cache changed before commit", err)
					}
					checkedCache = true
					tx.AddError(errors.New("injected transactional failure"))
				}
			}
			name := "lingtu_model_default_failure"
			db.Callback().Create().Before("gorm:create").Register(name, reject)
			db.Callback().Update().Before("gorm:update").Register(name, reject)
			err := persistManagedModel(channel, true)
			db.Callback().Create().Remove(name)
			db.Callback().Update().Remove(name)
			if err == nil || !checkedCache {
				t.Fatal("failure not exercised", err, checkedCache)
			}
			var stored model.Channel
			if err := db.First(&stored, originalID).Error; err != nil || stored.Key != "fixture-provider-key" {
				t.Fatal(stored.Key, err)
			}
			var abilities int64
			db.Model(&model.Ability{}).Where("channel_id = ?", originalID).Count(&abilities)
			if abilities != 1 {
				t.Fatal("ability update not rolled back", abilities)
			}
			after, err := lingtu.LoadTrialPolicy(db)
			if err != nil || !reflect.DeepEqual(before, after) {
				t.Fatal(after, err)
			}
			cached, err := model.CacheGetChannel(originalID)
			if err != nil || cached.Key != "fixture-provider-key" {
				t.Fatal("failed transaction refreshed cache", cached, err)
			}
			// A successful update becomes visible to the native cache only after commit.
			if err := persistManagedModel(channel, true); err != nil {
				t.Fatal(err)
			}
			cached, err = model.CacheGetChannel(originalID)
			if err != nil || cached.Key != "replacement-secret" {
				t.Fatal(cached, err)
			}
		})
	}
}

func TestLingtuManagedModelNewChannelPolicyFailureIsAtomic(t *testing.T) {
	db := managedModelDB(t)
	before := putModelPolicy(t, db)
	reject := func(tx *gorm.DB) {
		if tx.Statement.Schema != nil && tx.Statement.Schema.Table == "lingtu_settings" {
			tx.AddError(errors.New("injected policy write failure"))
		}
	}
	name := "lingtu_new_default_failure"
	db.Callback().Update().Before("gorm:update").Register(name, reject)
	db.Callback().Create().Before("gorm:create").Register(name, reject)
	channel := qwenModelFixture()
	err := persistManagedModel(channel, true)
	db.Callback().Update().Remove(name)
	db.Callback().Create().Remove(name)
	if err == nil {
		t.Fatal("policy failure ignored")
	}
	var count int64
	if err := db.Model(&model.Channel{}).Count(&count).Error; err != nil || count != 0 {
		t.Fatal("channel persisted after rollback", count, err)
	}
	if err := db.Model(&model.Ability{}).Count(&count).Error; err != nil || count != 0 {
		t.Fatal("ability persisted after rollback", count, err)
	}
	after, err := lingtu.LoadTrialPolicy(db)
	if err != nil || !reflect.DeepEqual(before, after) {
		t.Fatal(after, err)
	}
	if _, err := model.CacheGetChannel(channel.Id); err == nil {
		t.Fatal("rolled-back channel entered native cache")
	}
}

func TestLingtuManagedModelDefaultRequestValidation(t *testing.T) {
	for _, r := range []configurationRequest{{Section: "qwen", MakeDefault: true, Enabled: false}, {Section: "qwen", MakeDefault: true, Enabled: true, ClearSecret: true}, {Section: "unknown", MakeDefault: true, Enabled: true}} {
		if err := (&Host{}).saveModel(nil, r); !errors.Is(err, lingtu.ErrInvalidTrialInput) {
			t.Fatal(r.Section, err)
		}
	}
	var r configurationRequest
	if common.Unmarshal([]byte(`{"section":"qwen","enabled":true,"make_default":true}`), &r) != nil || !r.MakeDefault {
		t.Fatal("make_default not bound")
	}
	r = configurationRequest{}
	if common.Unmarshal([]byte(`{"section":"qwen","enabled":true}`), &r) != nil || r.MakeDefault {
		t.Fatal("legacy payload rejected")
	}
}

func TestLingtuManagedModelMalformedPolicyRollsBackUpdate(t *testing.T) {
	db := managedModelDB(t)
	channel := qwenModelFixture()
	if err := persistManagedModel(channel, false); err != nil {
		t.Fatal(err)
	}
	if err := db.Save(&lingtu.ManagedSetting{Name: "trial_policy", Value: "invalid-policy"}).Error; err != nil {
		t.Fatal(err)
	}
	channel.Key = "replacement-secret"
	if err := persistManagedModel(channel, true); err == nil {
		t.Fatal("malformed policy accepted")
	}
	var stored model.Channel
	if err := db.First(&stored, channel.Id).Error; err != nil || stored.Key != "fixture-provider-key" {
		t.Fatal("channel changed despite policy error", stored.Key, err)
	}
	cached, err := model.CacheGetChannel(channel.Id)
	if err != nil || cached.Key != "fixture-provider-key" {
		t.Fatal(cached, err)
	}
}
