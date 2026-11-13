package lingtuhost

import (
	"context"
	"encoding/json"
	"errors"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/lingtu"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relay"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func TestLingtuConnectionCatalogMigratesLegacyWithoutSecrets(t *testing.T) {
	db := managedModelDB(t)
	old := qwenModelFixture()
	if err := persistManagedModel(old, true); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Request = httptest.NewRequest("GET", "/api/lingtu/admin/config", nil)
		(&Host{}).adminConfig(c)
		var data struct {
			Catalog     []json.RawMessage `json:"model_catalog"`
			Connections []struct {
				ID    int    `json:"connection_id"`
				Model string `json:"model_id"`
			} `json:"model_connections"`
		}
		if err := json.Unmarshal(w.Body.Bytes(), &data); err != nil || w.Code != 200 || len(data.Catalog) != 28 || len(data.Connections) != 1 {
			t.Fatalf("real catalog/migration missing: code=%d catalog=%d connections=%d err=%v", w.Code, len(data.Catalog), len(data.Connections), err)
		}
		if data.Connections[0].ID != old.Id || data.Connections[0].Model != "qwen-plus" || strings.Contains(w.Body.String(), "fixture-provider-key") {
			t.Fatal("migration changed route or exposed secret")
		}
	}
	var stored model.Channel
	if db.First(&stored, old.Id).Error != nil || stored.Key != old.Key || stored.Models != old.Models {
		t.Fatal("legacy channel changed")
	}
}

func connectionRequest(t *testing.T, raw string) configurationRequest {
	t.Helper()
	var r configurationRequest
	if err := json.Unmarshal([]byte(raw), &r); err != nil {
		t.Fatal(err)
	}
	return r
}
func connectionState(t *testing.T) map[string]any {
	t.Helper()
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest("GET", "/api/lingtu/admin/config", nil)
	(&Host{}).adminConfig(c)
	var result map[string]any
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &result) != nil {
		t.Fatalf("config failed %d %s", w.Code, w.Body.String())
	}
	return result
}
func TestLingtuConnectionIndependentSaveRetainClearAndNoDefault(t *testing.T) {
	db := managedModelDB(t)
	h := &Host{}
	before := putModelPolicy(t, db)
	for _, raw := range []string{`{"section":"model_connection","action":"save","provider":"deepseek","name":"primary","secret":"first-secret","base_url":"https://api.deepseek.com","upstream_model":"deepseek-chat","enabled":false}`, `{"section":"model_connection","action":"save","provider":"deepseek","name":"second","secret":"second-secret","base_url":"https://api.deepseek.com","upstream_model":"deepseek-chat","enabled":false}`} {
		if err := h.saveModel(nil, connectionRequest(t, raw)); err != nil {
			t.Fatalf("independent save rejected: %v", err)
		}
	}
	state := connectionState(t)
	rows := state["model_connections"].([]any)
	if len(rows) != 2 {
		t.Fatal("independent APIs collapsed")
	}
	id := int(rows[0].(map[string]any)["connection_id"].(float64))
	raw := `{"section":"model_connection","action":"save","provider":"deepseek","connection_id":` + strconv.Itoa(id) + `,"name":"renamed","base_url":"https://api.deepseek.com","upstream_model":"deepseek-chat","enabled":false}`
	if err := h.saveModel(nil, connectionRequest(t, raw)); err != nil {
		t.Fatal(err)
	}
	var channel model.Channel
	if db.First(&channel, id).Error != nil || channel.Key != "first-secret" {
		t.Fatal("blank secret did not retain")
	}
	blankRequest := connectionRequest(t, raw)
	blankRequest.Secret = " \t "
	if err := h.saveModel(nil, blankRequest); err != nil {
		t.Fatal(err)
	}
	if db.First(&channel, id).Error != nil || channel.Key != "first-secret" {
		t.Fatal("whitespace blank secret did not retain")
	}
	var cipher string
	db.Model(&model.Channel{}).Select("key").Where("id = ?", id).Row().Scan(&cipher)
	if strings.Contains(cipher, "first-secret") {
		t.Fatal("unencrypted credential")
	}
	encoded, _ := json.Marshal(connectionState(t))
	if strings.Contains(string(encoded), "first-secret") || strings.Contains(string(encoded), "second-secret") || strings.Contains(string(encoded), cipher) {
		t.Fatal("secret disclosure")
	}
	after, _ := lingtu.LoadTrialPolicy(db)
	if before != after {
		t.Fatal("save switched default")
	}
	raw = strings.Replace(raw, `"enabled":false`, `"enabled":false,"clear_secret":true`, 1)
	if err := h.saveModel(nil, connectionRequest(t, raw)); err != nil {
		t.Fatal(err)
	}
	if db.First(&channel, id).Error != nil || channel.Key != "" {
		t.Fatal("explicit clear ignored")
	}
	var count int64
	db.Model(&model.Channel{}).Count(&count)
	if count != 2 {
		t.Fatal("save overwrote other connection")
	}
}
func TestLingtuConnectionRejectsInvalidEndpointAndUnknownProvider(t *testing.T) {
	managedModelDB(t)
	for _, base := range []string{"file:///etc/passwd", "http://api.deepseek.com", "https://user:pass@api.deepseek.com", "https://127.0.0.1", "https://[::1]", "https://192.168.1.2", "https://localhost", "https://api.deepseek.com/?key=secret", "https://api.deepseek.com/#fragment"} {
		raw, _ := json.Marshal(map[string]any{"section": "model_connection", "action": "save", "provider": "deepseek", "name": "bad", "secret": "fixture", "base_url": base, "upstream_model": "deepseek-chat"})
		if err := (&Host{}).saveModel(nil, connectionRequest(t, string(raw))); err == nil {
			t.Fatal("unsafe endpoint accepted", base)
		}
	}
	raw := `{"section":"model_connection","action":"save","provider":"unknown","name":"bad","secret":"fixture","base_url":"https://api.deepseek.com","upstream_model":"deepseek-chat"}`
	if err := (&Host{}).saveModel(nil, connectionRequest(t, raw)); err == nil {
		t.Fatal("unknown adapter accepted")
	}
	var count int64
	model.DB.Model(&model.Channel{}).Count(&count)
	if count != 0 {
		t.Fatal("invalid config was persisted")
	}
}

func TestLingtuConnectionProbeFailureNeverReportsSavedAsTested(t *testing.T) {
	db := managedModelDB(t)
	h := &Host{}
	r := connectionRequest(t, `{"section":"model_connection","action":"save","provider":"vllm","name":"local","base_url":"http://127.0.0.1:12345","upstream_model":"fixture-model","enabled":true}`)
	if err := h.saveModel(nil, r); err != nil {
		t.Fatal(err)
	}
	rows := connectionState(t)["model_connections"].([]any)
	v := rows[0].(map[string]any)
	id := int(v["connection_id"].(float64))
	alias := v["model_id"].(string)
	test := connectionRequest(t, `{"section":"model_connection","action":"test","provider":"vllm","connection_id":`+strconv.Itoa(id)+`}`)
	if err := h.executeModelConnection(nil, test, func(context.Context, *model.Channel, int) error { return errors.New("provider-secret-must-not-escape") }); err == nil || strings.Contains(err.Error(), "provider-secret") {
		t.Fatal("test result not sanitized")
	}
	var meta lingtu.ModelConnection
	if db.First(&meta, id).Error != nil || meta.TestStatus != "failed" {
		t.Fatal("failed saved state lost")
	}
	if _, err := selectedChannel(alias); err == nil {
		t.Fatal("failed connection routed")
	}
	if err := h.executeModelConnection(nil, test, func(context.Context, *model.Channel, int) error { return nil }); err != nil {
		t.Fatal(err)
	}
	if _, err := selectedChannel(alias); err != nil {
		t.Fatal("tested selfhost connection cannot route", err)
	}
	selectR := connectionRequest(t, `{"section":"model_connection","action":"select","provider":"vllm","connection_id":`+strconv.Itoa(id)+`}`)
	if err := h.saveModel(nil, selectR); err != nil {
		t.Fatal(err)
	}
	policy, _ := lingtu.LoadTrialPolicy(db)
	if policy.DefaultModel != alias {
		t.Fatal("explicit selection ignored")
	}
	if err := h.saveModel(nil, connectionRequest(t, `{"section":"model_connection","action":"delete","provider":"vllm","connection_id":`+strconv.Itoa(id)+`}`)); err == nil {
		t.Fatal("deleted selected connection")
	}
	// Simulate a native admin changing the actual channel outside this facade.
	var ch model.Channel
	db.First(&ch, id)
	changed := "http://127.0.0.1:12346"
	ch.BaseURL = &changed
	db.Save(&ch)
	if _, err := selectedChannel(alias); err == nil {
		t.Fatal("stale tested config routed")
	}
	state := connectionState(t)
	v = state["model_connections"].([]any)[0].(map[string]any)
	if v["test_status"] != "stale" || v["ready"] != false {
		t.Fatal("stale test displayed as current")
	}
	// Testing an out-of-band changed channel must record a new revision/hash first.
	if err := h.executeModelConnection(nil, test, func(context.Context, *model.Channel, int) error { return nil }); err == nil {
		t.Fatal("untracked native config got tested success")
	}
}

func TestLingtuConnectionMigrationSurvivesOldSaveSection(t *testing.T) {
	db := managedModelDB(t)
	old := qwenModelFixture()
	base := "https://dashscope.aliyuncs.com/compatible-mode"
	old.BaseURL = &base
	if err := persistManagedModel(old, false); err != nil {
		t.Fatal(err)
	}
	if err := db.Transaction(migrateLegacyModelConnections); err != nil {
		t.Fatal(err)
	}
	old.Key = "legacy-replacement"
	if err := persistManagedModel(old, true); err != nil {
		t.Fatal(err)
	}
	var row lingtu.ModelConnection
	db.First(&row, old.Id)
	if row.ConfigHash != channelHash(*old) || row.TestStatus != "success" {
		t.Fatal("legacy save left stale binding")
	}
}

func TestLingtuConnectionTestSelectionRequiresCurrentRevision(t *testing.T) {
	db := managedModelDB(t)
	h := &Host{}
	raw := `{"section":"model_connection","action":"save","provider":"vllm","name":"test","base_url":"http://127.0.0.1:12345","upstream_model":"fixture","enabled":true}`
	if err := h.saveModel(nil, connectionRequest(t, raw)); err != nil {
		t.Fatal(err)
	}
	var meta lingtu.ModelConnection
	db.First(&meta)
	r := configurationRequest{Section: "model_connection", Provider: "vllm", ConnectionID: meta.ChannelID, Action: "test", Revision: meta.Revision}
	if err := h.executeModelConnection(nil, r, func(context.Context, *model.Channel, int) error {
		var latest lingtu.ModelConnection
		db.First(&latest, meta.ChannelID)
		latest.Revision++
		return db.Save(&latest).Error
	}); err == nil {
		t.Fatal("accepted test after concurrent config change")
	}
	var ch model.Channel
	db.First(&ch, meta.ChannelID)
	if ch.Status == 1 {
		t.Fatal("stale probe enabled channel")
	}
}

func TestLingtuConnectionEmailStateUsesNativeEnableFlags(t *testing.T) {
	managedModelDB(t)
	beforeVerification, beforeRegister, beforePassword := common.EmailVerificationEnabled, common.RegisterEnabled, common.PasswordRegisterEnabled
	t.Cleanup(func() {
		common.EmailVerificationEnabled = beforeVerification
		common.RegisterEnabled = beforeRegister
		common.PasswordRegisterEnabled = beforePassword
	})
	common.EmailVerificationEnabled = false
	common.RegisterEnabled = false
	common.PasswordRegisterEnabled = true
	smtp := connectionState(t)["smtp"].(map[string]any)
	if smtp["enabled"] != false || smtp["registration_enabled"] != false || smtp["email_verification"] != false {
		t.Fatal("email enable state absent or inferred")
	}
}

func TestLingtuConnectionAllCatalogEntriesUseNativeAdapters(t *testing.T) {
	seen := map[string]bool{}
	for _, p := range managedModelCatalog() {
		apiType, ok := common.ChannelType2APIType(p.ChannelType)
		// Azure is the native OpenAI adapter's explicit channel-type branch;
		// upstream ChannelType2APIType deliberately returns its OpenAI default.
		if (!ok && p.ChannelType != constant.ChannelTypeAzure) || relay.GetAdaptor(apiType) == nil || seen[p.Provider] || p.SetupURL == "" || p.CredentialFormat == "" {
			t.Fatal("catalog is not real native adapter", p.Provider)
		}
		seen[p.Provider] = true
	}
	if len(seen) != 28 {
		t.Fatal("incorrect approved catalog", len(seen))
	}
}
func TestLingtuConnectionMetadataFailureRollsBackNativeRows(t *testing.T) {
	db := managedModelDB(t)
	before := putModelPolicy(t, db)
	name := "reject_managed_connection_metadata"
	db.Callback().Create().Before("gorm:create").Register(name, func(tx *gorm.DB) {
		if tx.Statement.Schema != nil && tx.Statement.Schema.Table == "lingtu_model_connections" {
			tx.AddError(errors.New("injected metadata write error"))
		}
	})
	err := (&Host{}).saveModel(nil, connectionRequest(t, `{"section":"model_connection","action":"save","provider":"deepseek","name":"atomic","secret":"private-fixture","base_url":"https://api.deepseek.com","upstream_model":"deepseek-chat","enabled":false}`))
	db.Callback().Create().Remove(name)
	if err == nil {
		t.Fatal("metadata failure not exercised")
	}
	for _, table := range []any{&model.Channel{}, &model.Ability{}, &lingtu.ModelConnection{}} {
		var count int64
		if db.Model(table).Count(&count).Error != nil || count != 0 {
			t.Fatal("partial configuration committed", table, count)
		}
	}
	after, _ := lingtu.LoadTrialPolicy(db)
	if before != after {
		t.Fatal("failed save changed default")
	}
}

func TestLingtuConnectionSpecializedFieldsRejectAmbiguousCredentials(t *testing.T) {
	for _, bad := range []struct{ provider, key, model, other string }{
		{"azure", "fixture", "deployment", "2025-01-01&other=value"},
		{"vertex", "plain-api-key", "gemini-2.5-flash", "global"},
		{"hunyuan", "plain-api-key", "hunyuan-lite", ""},
		{"bedrock", "plain-api-key", "claude-sonnet", ""},
		{"spark", "app|secret|key", "generalv3.5", ""},
		{"cloudflare", "fixture", "@cf/model", "path/not-account-id"},
	} {
		p, _ := managedProvider(bad.provider)
		base := p.BaseURL
		if bad.provider == "azure" {
			base = "https://resource.openai.azure.com"
		}
		ch := model.Channel{Type: p.ChannelType, Key: bad.key, Models: bad.model, Other: bad.other, Group: "default", BaseURL: &base}
		if validateConnection(p, ch, true) == nil {
			t.Fatal("invalid specialized configuration accepted", bad.provider)
		}
	}
}
