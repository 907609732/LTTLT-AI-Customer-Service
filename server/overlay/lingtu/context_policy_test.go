package lingtu

import (
	"bytes"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"gorm.io/gorm"
)

func contextPolicyDB(t *testing.T) *gorm.DB {
	t.Helper()
	db := trialDB(t)
	vault, err := NewVault(bytes.Repeat([]byte{6}, 32))
	if err != nil {
		t.Fatal(err)
	}
	SetEncryptionVault(vault)
	if err := db.AutoMigrate(&ManagedSetting{}); err != nil {
		t.Fatal(err)
	}
	return db
}

func TestLingtuContextPolicyDefaults(t *testing.T) {
	db := contextPolicyDB(t)
	policy, err := LoadContextPolicy(db)
	if err != nil {
		t.Fatal(err)
	}
	if policy.Revision != 0 {
		t.Fatalf("new policy revision = %d, want 0", policy.Revision)
	}
	if policy.RuntimeContext.Enabled {
		t.Fatal("reception policy unexpectedly enabled without a stored row")
	}
	if policy.RuntimeContext.SystemPrompt != "" {
		t.Fatal("default hidden prompt must be empty")
	}
	if policy.RuntimeContext.RetrievalBudget != 3000 {
		t.Fatalf("default retrieval budget = %d, want 3000", policy.RuntimeContext.RetrievalBudget)
	}
	wantOrder := []string{"binding", "store", "canonical", "template"}
	if strings.Join(policy.RuntimeContext.RetrievalOrder, ",") != strings.Join(wantOrder, ",") {
		t.Fatalf("default retrieval order = %v", policy.RuntimeContext.RetrievalOrder)
	}
	if policy.Learning.Enabled {
		t.Fatal("new detail-page learning must default to disabled")
	}
	// Vision is an allowed capability, not an activation switch. The learning
	// task remains off until enabled, and model capability is checked again
	// when a learning request is actually prepared.
	if !policy.Learning.VisionEnabled {
		t.Fatal("vision learning capability should default to allowed")
	}
	if strings.Join(policy.Learning.AllowedSources, ",") != "pdd_detail_text,pdd_detail_image" {
		t.Fatalf("default allowed sources = %v", policy.Learning.AllowedSources)
	}
	if policy.Learning.MaxCallsPerProduct != 20 {
		t.Fatalf("default calls per product = %d", policy.Learning.MaxCallsPerProduct)
	}
	if policy.Learning.MaxOutputTokens != 4096 {
		t.Fatalf("default learning output = %d", policy.Learning.MaxOutputTokens)
	}
	if !policy.Learning.RequiresReview {
		t.Fatal("learning must require human review by default")
	}
	if policy.Learning.VideoMode != "disabled" || policy.Learning.ASRMode != "disabled" {
		t.Fatalf("video/asr defaults = %q/%q", policy.Learning.VideoMode, policy.Learning.ASRMode)
	}
}

func TestLingtuContextPolicyCAS(t *testing.T) {
	db := contextPolicyDB(t)
	first := DefaultContextPolicyInput()
	first.RuntimeContext.SystemPrompt = "规则：\"只答商品事实\"\n第二行 🙂\nline three"
	first.RuntimeContext.RetrievalBudget = 2800

	saved, err := SaveContextPolicy(db, 0, first)
	if err != nil {
		t.Fatal(err)
	}
	if saved.Revision != 1 {
		t.Fatalf("first revision = %d, want 1", saved.Revision)
	}
	loaded, err := LoadContextPolicy(db)
	if err != nil {
		t.Fatal(err)
	}
	if loaded.Revision != 1 || loaded.RuntimeContext.SystemPrompt != first.RuntimeContext.SystemPrompt || loaded.RuntimeContext.RetrievalBudget != 2800 {
		t.Fatalf("saved policy not loaded verbatim: %+v", loaded)
	}

	var raw string
	if err := db.Raw("SELECT value FROM lingtu_settings WHERE name = ?", ContextPolicySettingName).Scan(&raw).Error; err != nil {
		t.Fatal(err)
	}
	if raw == "" || strings.Contains(raw, "只答商品事实") || strings.Contains(raw, "line three") {
		t.Fatal("hidden policy prompt was not encrypted at rest")
	}

	if _, err = SaveContextPolicy(db, 0, first); !errors.Is(err, ErrContextPolicyConflict) {
		t.Fatalf("second insert at revision 0: %v", err)
	}
	loaded, err = LoadContextPolicy(db)
	if err != nil || loaded.Revision != 1 || loaded.RuntimeContext.RetrievalBudget != 2800 {
		t.Fatalf("conflict changed stored policy: %+v %v", loaded, err)
	}

	second := first
	second.RuntimeContext.SystemPrompt = "replacement\nrules"
	second.RuntimeContext.RetrievalBudget = 3200
	saved, err = SaveContextPolicy(db, 1, second)
	if err != nil {
		t.Fatal(err)
	}
	if saved.Revision != 2 {
		t.Fatalf("second revision = %d, want 2", saved.Revision)
	}
	var updatedRaw string
	if err := db.Raw("SELECT value FROM lingtu_settings WHERE name = ?", ContextPolicySettingName).Scan(&updatedRaw).Error; err != nil {
		t.Fatal(err)
	}
	if updatedRaw == "" || updatedRaw == raw || strings.Contains(updatedRaw, "replacement") {
		t.Fatal("updated hidden policy prompt was not re-encrypted at rest")
	}
	if _, err = SaveContextPolicy(db, 1, first); !errors.Is(err, ErrContextPolicyConflict) {
		t.Fatalf("stale update at revision 1: %v", err)
	}
	loaded, err = LoadContextPolicy(db)
	if err != nil || loaded.Revision != 2 || loaded.RuntimeContext.SystemPrompt != "replacement\nrules" || loaded.RuntimeContext.RetrievalBudget != 3200 {
		t.Fatalf("stale update changed stored policy: %+v %v", loaded, err)
	}
}

func TestLingtuContextPolicyVisionCapability(t *testing.T) {
	db := contextPolicyDB(t)
	input := DefaultContextPolicyInput()
	if input.Learning.Enabled {
		t.Fatal("vision capability test requires learning to remain disabled by default")
	}
	if !input.Learning.VisionEnabled {
		t.Fatal("vision capability should default to allowed")
	}
	input.Learning.VisionEnabled = false
	saved, err := SaveContextPolicy(db, 0, input)
	if err != nil {
		t.Fatal(err)
	}
	if saved.Learning.VisionEnabled {
		t.Fatal("saved policy ignored administrator vision disable")
	}
	loaded, err := LoadContextPolicy(db)
	if err != nil {
		t.Fatal(err)
	}
	if loaded.Learning.VisionEnabled {
		t.Fatal("loaded policy ignored administrator vision disable")
	}
	projection := loaded.ClientProjection()
	if projection.Learning.VisionEnabled {
		t.Fatal("client projection ignored administrator vision disable")
	}
	raw, err := json.Marshal(projection)
	if err != nil {
		t.Fatal(err)
	}
	var decoded struct {
		Learning struct {
			VisionEnabled *bool `json:"vision_enabled"`
		} `json:"learning"`
	}
	if err := json.Unmarshal(raw, &decoded); err != nil {
		t.Fatal(err)
	}
	if decoded.Learning.VisionEnabled == nil || *decoded.Learning.VisionEnabled {
		t.Fatalf("client projection vision_enabled = %v: %s", decoded.Learning.VisionEnabled, raw)
	}
}

func TestLingtuContextPolicyValidation(t *testing.T) {
	db := contextPolicyDB(t)
	valid := DefaultContextPolicyInput()
	if err := valid.Validate(); err != nil {
		t.Fatalf("default policy rejected: %v", err)
	}

	tests := []struct {
		name   string
		change func(*ContextPolicyInput)
	}{
		{"prompt too long", func(p *ContextPolicyInput) { p.RuntimeContext.SystemPrompt = strings.Repeat("灵", 2731) }},
		{"prompt invalid utf8", func(p *ContextPolicyInput) { p.RuntimeContext.SystemPrompt = string([]byte{0xff, 0xfe}) }},
		{"budget too small", func(p *ContextPolicyInput) { p.RuntimeContext.RetrievalBudget = 255 }},
		{"budget too large", func(p *ContextPolicyInput) { p.RuntimeContext.RetrievalBudget = 4097 }},
		{"order binding not first", func(p *ContextPolicyInput) {
			p.RuntimeContext.RetrievalOrder = []string{"store", "binding", "canonical", "template"}
		}},
		{"order template not last", func(p *ContextPolicyInput) {
			p.RuntimeContext.RetrievalOrder = []string{"binding", "store", "template", "canonical"}
		}},
		{"order duplicate middle", func(p *ContextPolicyInput) {
			p.RuntimeContext.RetrievalOrder = []string{"binding", "store", "store", "template"}
		}},
		{"learning output too small", func(p *ContextPolicyInput) { p.Learning.MaxOutputTokens = 511 }},
		{"learning output too large", func(p *ContextPolicyInput) { p.Learning.MaxOutputTokens = 4097 }},
		{"unknown source", func(p *ContextPolicyInput) { p.Learning.AllowedSources = []string{"pdd_detail_text", "pdd_video"} }},
		{"duplicate source", func(p *ContextPolicyInput) {
			p.Learning.AllowedSources = []string{"pdd_detail_text", "pdd_detail_text"}
		}},
		{"review disabled", func(p *ContextPolicyInput) { p.Learning.RequiresReview = false }},
		{"video enabled", func(p *ContextPolicyInput) { p.Learning.VideoMode = "enabled" }},
		{"asr enabled", func(p *ContextPolicyInput) { p.Learning.ASRMode = "enabled" }},
		{"too many calls", func(p *ContextPolicyInput) { p.Learning.MaxCallsPerProduct = 21 }},
		{"enabled without sources", func(p *ContextPolicyInput) { p.Learning.Enabled = true; p.Learning.AllowedSources = nil }},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			candidate := valid
			candidate.RuntimeContext.RetrievalOrder = append([]string(nil), valid.RuntimeContext.RetrievalOrder...)
			candidate.Learning.AllowedSources = append([]string(nil), valid.Learning.AllowedSources...)
			test.change(&candidate)
			if err := candidate.Validate(); !errors.Is(err, ErrInvalidContextPolicy) {
				t.Fatalf("validation error = %v", err)
			}
			if _, err := SaveContextPolicy(db, 0, candidate); !errors.Is(err, ErrInvalidContextPolicy) {
				t.Fatalf("invalid save error = %v", err)
			}
		})
	}

	var count int64
	db.Model(&ManagedSetting{}).Where("name = ?", ContextPolicySettingName).Count(&count)
	if count != 0 {
		t.Fatal("invalid policy was persisted")
	}

	boundary := DefaultContextPolicyInput()
	boundary.RuntimeContext.SystemPrompt = strings.Repeat("a", 8192)
	if err := boundary.Validate(); err != nil {
		t.Fatalf("8192-byte prompt rejected: %v", err)
	}
	over := DefaultContextPolicyInput()
	over.RuntimeContext.SystemPrompt = strings.Repeat("a", 8193)
	if err := over.Validate(); !errors.Is(err, ErrInvalidContextPolicy) {
		t.Fatalf("8193-byte prompt accepted: %v", err)
	}

	swapped := DefaultContextPolicyInput()
	swapped.RuntimeContext.RetrievalOrder = []string{"binding", "canonical", "store", "template"}
	if err := swapped.Validate(); err != nil {
		t.Fatalf("administrator store/canonical swap rejected: %v", err)
	}
}

func TestLingtuContextPolicyProjection(t *testing.T) {
	policy := DefaultContextPolicy()
	policy.Revision = 7
	policy.RuntimeContext.Enabled = true
	policy.RuntimeContext.SystemPrompt = "hidden-system-rule-do-not-leak"
	policy.RuntimeContext.RetrievalBudget = 2600
	policy.RuntimeContext.RetrievalOrder = []string{"binding", "canonical", "store", "template"}
	policy.Learning.Enabled = true

	projection := policy.ClientProjection()
	raw, err := json.Marshal(projection)
	if err != nil {
		t.Fatal(err)
	}
	text := string(raw)
	for _, forbidden := range []string{"hidden-system-rule-do-not-leak", "system_prompt", "prompt", "provider", "api_key"} {
		if strings.Contains(text, forbidden) {
			t.Fatalf("client projection leaked %q: %s", forbidden, text)
		}
	}
	var decoded map[string]any
	if err := json.Unmarshal(raw, &decoded); err != nil {
		t.Fatal(err)
	}
	if decoded["runtime_context"].(map[string]any)["retrieval_budget"].(float64) != 2600 {
		t.Fatalf("projection budget missing: %s", text)
	}
	if decoded["learning"].(map[string]any)["requires_review"] != true {
		t.Fatalf("projection review flag missing: %s", text)
	}
	if projection.Revision != 7 {
		t.Fatalf("projection revision = %d", projection.Revision)
	}

	projection.RuntimeContext.RetrievalOrder[0] = "template"
	projection.Learning.AllowedSources[0] = "mutated"
	if policy.RuntimeContext.RetrievalOrder[0] != "binding" || policy.Learning.AllowedSources[0] != "pdd_detail_text" {
		t.Fatal("client projection shares mutable slices with the stored policy")
	}
}

func TestLingtuContextPolicyLoadRejectsDamagedStoredValue(t *testing.T) {
	db := contextPolicyDB(t)
	raw := `{"runtime_context":{"enabled":false,"system_prompt":"","retrieval_budget":3000,"retrieval_order":["binding","store","canonical","template"]},"learning":{"enabled":false,"allowed_sources":["pdd_detail_text","pdd_detail_image"],"max_calls_per_product":20,"max_output_tokens":4096,"requires_review":true,"video_mode":"disabled","asr_mode":"disabled"}}`
	if err := db.Create(&ManagedSetting{Name: ContextPolicySettingName, Value: raw, Revision: 1}).Error; err != nil {
		t.Fatal(err)
	}
	var sealed string
	if err := db.Raw("SELECT value FROM lingtu_settings WHERE name = ?", ContextPolicySettingName).Scan(&sealed).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec("UPDATE lingtu_settings SET value = ? WHERE name = ?", sealed[:len(sealed)-4]+"AAAA", ContextPolicySettingName).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := LoadContextPolicy(db); err == nil {
		t.Fatal("damaged ciphertext fell back to defaults")
	}
}
