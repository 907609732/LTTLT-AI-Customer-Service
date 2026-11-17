package lingtu

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
	"unicode/utf8"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// The context policy is a single global managed-mode setting. It is stored in
// the existing encrypted lingtu_settings table; the revision column is the
// optimistic concurrency token for administrator saves.
const (
	ContextPolicySettingName          = "context_policy"
	ContextPolicyPromptMaxBytes       = 8192
	ContextPolicyBudgetMin            = 256
	ContextPolicyBudgetMax            = 4096
	ContextPolicyLearningOutputMin    = 512
	ContextPolicyLearningOutputMax    = 4096
	ContextPolicyMaxCallsPerProduct   = 20
	ContextPolicyDefaultRetrievalSize = 3000
)

var (
	ErrContextPolicyConflict = errors.New("managed context policy revision conflict")
	ErrInvalidContextPolicy  = errors.New("invalid managed context policy")
)

type RuntimeContextPolicy struct {
	Enabled         bool     `json:"enabled"`
	SystemPrompt    string   `json:"system_prompt"`
	RetrievalBudget int      `json:"retrieval_budget"`
	RetrievalOrder  []string `json:"retrieval_order"`
}

type LearningPolicy struct {
	Enabled bool `json:"enabled"`
	// VisionEnabled only expresses that policy permits image learning. It does
	// not start a learning task and never replaces the model capability check.
	VisionEnabled      bool     `json:"vision_enabled"`
	AllowedSources     []string `json:"allowed_sources"`
	MaxCallsPerProduct int      `json:"max_calls_per_product"`
	MaxOutputTokens    int      `json:"max_output_tokens"`
	RequiresReview     bool     `json:"requires_review"`
	VideoMode          string   `json:"video_mode"`
	ASRMode            string   `json:"asr_mode"`
}

// ContextPolicyInput is the complete administrator-editable candidate. It does
// not carry a revision: the expected revision is a separate CAS argument.
type ContextPolicyInput struct {
	RuntimeContext RuntimeContextPolicy `json:"runtime_context"`
	Learning       LearningPolicy       `json:"learning"`
}

type ManagedContextPolicy struct {
	Revision       int                  `json:"revision"`
	RuntimeContext RuntimeContextPolicy `json:"runtime_context"`
	Learning       LearningPolicy       `json:"learning"`
}

// ClientContextPolicy is the only policy shape that may leave the server for a
// desktop client. Hidden prompts, provider routing and credentials stay out.
type ClientContextPolicy struct {
	Revision       int                  `json:"revision"`
	RuntimeContext ClientRuntimeContext `json:"runtime_context"`
	Learning       ClientLearningPolicy `json:"learning"`
}

type ClientRuntimeContext struct {
	Enabled         bool     `json:"enabled"`
	RetrievalBudget int      `json:"retrieval_budget"`
	RetrievalOrder  []string `json:"retrieval_order"`
}

type ClientLearningPolicy struct {
	Enabled            bool     `json:"enabled"`
	VisionEnabled      bool     `json:"vision_enabled"`
	AllowedSources     []string `json:"allowed_sources"`
	MaxCallsPerProduct int      `json:"max_calls_per_product"`
	MaxOutputTokens    int      `json:"max_output_tokens"`
	RequiresReview     bool     `json:"requires_review"`
	VideoMode          string   `json:"video_mode"`
	ASRMode            string   `json:"asr_mode"`
}

func defaultRetrievalOrder() []string {
	return []string{"binding", "store", "canonical", "template"}
}

func DefaultContextPolicyInput() ContextPolicyInput {
	return ContextPolicyInput{
		RuntimeContext: RuntimeContextPolicy{
			Enabled:         false,
			SystemPrompt:    "",
			RetrievalBudget: ContextPolicyDefaultRetrievalSize,
			RetrievalOrder:  defaultRetrievalOrder(),
		},
		Learning: LearningPolicy{
			Enabled:            false,
			VisionEnabled:      true,
			AllowedSources:     []string{"pdd_detail_text", "pdd_detail_image"},
			MaxCallsPerProduct: ContextPolicyMaxCallsPerProduct,
			MaxOutputTokens:    ContextPolicyLearningOutputMax,
			RequiresReview:     true,
			VideoMode:          "disabled",
			ASRMode:            "disabled",
		},
	}
}

func DefaultContextPolicy() ManagedContextPolicy {
	return managedContextPolicy(0, DefaultContextPolicyInput())
}

func managedContextPolicy(revision int, input ContextPolicyInput) ManagedContextPolicy {
	return ManagedContextPolicy{
		Revision: revision,
		RuntimeContext: RuntimeContextPolicy{
			Enabled:         input.RuntimeContext.Enabled,
			SystemPrompt:    input.RuntimeContext.SystemPrompt,
			RetrievalBudget: input.RuntimeContext.RetrievalBudget,
			RetrievalOrder:  append([]string(nil), input.RuntimeContext.RetrievalOrder...),
		},
		Learning: LearningPolicy{
			Enabled:            input.Learning.Enabled,
			VisionEnabled:      input.Learning.VisionEnabled,
			AllowedSources:     append([]string(nil), input.Learning.AllowedSources...),
			MaxCallsPerProduct: input.Learning.MaxCallsPerProduct,
			MaxOutputTokens:    input.Learning.MaxOutputTokens,
			RequiresReview:     input.Learning.RequiresReview,
			VideoMode:          input.Learning.VideoMode,
			ASRMode:            input.Learning.ASRMode,
		},
	}
}

func (p ManagedContextPolicy) Input() ContextPolicyInput {
	return ContextPolicyInput{
		RuntimeContext: RuntimeContextPolicy{
			Enabled:         p.RuntimeContext.Enabled,
			SystemPrompt:    p.RuntimeContext.SystemPrompt,
			RetrievalBudget: p.RuntimeContext.RetrievalBudget,
			RetrievalOrder:  append([]string(nil), p.RuntimeContext.RetrievalOrder...),
		},
		Learning: LearningPolicy{
			Enabled:            p.Learning.Enabled,
			VisionEnabled:      p.Learning.VisionEnabled,
			AllowedSources:     append([]string(nil), p.Learning.AllowedSources...),
			MaxCallsPerProduct: p.Learning.MaxCallsPerProduct,
			MaxOutputTokens:    p.Learning.MaxOutputTokens,
			RequiresReview:     p.Learning.RequiresReview,
			VideoMode:          p.Learning.VideoMode,
			ASRMode:            p.Learning.ASRMode,
		},
	}
}

func (p ContextPolicyInput) Validate() error {
	if !utf8.ValidString(p.RuntimeContext.SystemPrompt) {
		return invalidContextPolicy("system prompt must be valid UTF-8")
	}
	if len(p.RuntimeContext.SystemPrompt) > ContextPolicyPromptMaxBytes {
		return invalidContextPolicy("system prompt exceeds %d UTF-8 bytes", ContextPolicyPromptMaxBytes)
	}
	if p.RuntimeContext.RetrievalBudget < ContextPolicyBudgetMin || p.RuntimeContext.RetrievalBudget > ContextPolicyBudgetMax {
		return invalidContextPolicy("retrieval budget must be between %d and %d", ContextPolicyBudgetMin, ContextPolicyBudgetMax)
	}
	if err := validateRetrievalOrder(p.RuntimeContext.RetrievalOrder); err != nil {
		return err
	}
	if p.Learning.MaxOutputTokens < ContextPolicyLearningOutputMin || p.Learning.MaxOutputTokens > ContextPolicyLearningOutputMax {
		return invalidContextPolicy("learning output must be between %d and %d", ContextPolicyLearningOutputMin, ContextPolicyLearningOutputMax)
	}
	if p.Learning.MaxCallsPerProduct < 1 || p.Learning.MaxCallsPerProduct > ContextPolicyMaxCallsPerProduct {
		return invalidContextPolicy("calls per product must be between 1 and %d", ContextPolicyMaxCallsPerProduct)
	}
	if !p.Learning.RequiresReview {
		return invalidContextPolicy("learning drafts must require human review")
	}
	if p.Learning.VideoMode != "disabled" {
		return invalidContextPolicy("video learning is not available")
	}
	if p.Learning.ASRMode != "disabled" {
		return invalidContextPolicy("speech recognition is not available")
	}
	if p.Learning.Enabled && len(p.Learning.AllowedSources) == 0 {
		return invalidContextPolicy("enabled learning requires an allowed source")
	}
	seen := make(map[string]struct{}, len(p.Learning.AllowedSources))
	for _, source := range p.Learning.AllowedSources {
		switch source {
		case "pdd_detail_text", "pdd_detail_image":
		default:
			return invalidContextPolicy("unsupported learning source %q", source)
		}
		if _, exists := seen[source]; exists {
			return invalidContextPolicy("duplicate learning source %q", source)
		}
		seen[source] = struct{}{}
	}
	return nil
}

func validateRetrievalOrder(order []string) error {
	if len(order) != 4 || order[0] != "binding" || order[3] != "template" {
		return invalidContextPolicy("retrieval order must start with binding and end with template")
	}
	middle := map[string]struct{}{}
	for _, name := range order[1:3] {
		if name != "store" && name != "canonical" {
			return invalidContextPolicy("unsupported retrieval stage %q", name)
		}
		if _, exists := middle[name]; exists {
			return invalidContextPolicy("duplicate retrieval stage %q", name)
		}
		middle[name] = struct{}{}
	}
	return nil
}

func invalidContextPolicy(format string, args ...any) error {
	return fmt.Errorf("%w: %s", ErrInvalidContextPolicy, fmt.Sprintf(format, args...))
}

// DecodeContextPolicyInput rejects unknown fields and trailing JSON so an
// administrator cannot smuggle server-only or misspelled properties into the
// stored policy.
func DecodeContextPolicyInput(data []byte) (ContextPolicyInput, error) {
	var input ContextPolicyInput
	decoder := json.NewDecoder(strings.NewReader(string(data)))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input); err != nil {
		return ContextPolicyInput{}, invalidContextPolicy("decode: %v", err)
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		return ContextPolicyInput{}, invalidContextPolicy("decode: unexpected trailing data")
	}
	if err := input.Validate(); err != nil {
		return ContextPolicyInput{}, err
	}
	return input, nil
}

// LoadContextPolicy returns revision 0 and disabled new rules when no row
// exists. A present but unreadable or malformed row is an error: silently
// substituting defaults would hide corruption or erase the admin's revision.
func LoadContextPolicy(db *gorm.DB) (ManagedContextPolicy, error) {
	var row ManagedSetting
	err := db.First(&row, "name = ?", ContextPolicySettingName).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return DefaultContextPolicy(), nil
	}
	if err != nil {
		return ManagedContextPolicy{}, err
	}
	if row.Revision < 1 {
		return ManagedContextPolicy{}, invalidContextPolicy("stored revision %d is invalid", row.Revision)
	}
	input, err := DecodeContextPolicyInput([]byte(row.Value))
	if err != nil {
		return ManagedContextPolicy{}, err
	}
	return managedContextPolicy(row.Revision, input), nil
}

// SaveContextPolicy stores the whole candidate only when the current row still
// has expectedRevision. Revision 0 inserts the first row; later saves use a
// single conditional UPDATE and inspect RowsAffected instead of reading first
// and unconditionally saving, so two administrators cannot silently overwrite
// one another.
func SaveContextPolicy(db *gorm.DB, expectedRevision int, next ContextPolicyInput) (ManagedContextPolicy, error) {
	if expectedRevision < 0 {
		return ManagedContextPolicy{}, invalidContextPolicy("revision must not be negative")
	}
	if err := next.Validate(); err != nil {
		return ManagedContextPolicy{}, err
	}
	raw, err := json.Marshal(next)
	if err != nil {
		return ManagedContextPolicy{}, err
	}
	nextRevision := expectedRevision + 1
	if expectedRevision == 0 {
		row := ManagedSetting{Name: ContextPolicySettingName, Value: string(raw), Revision: nextRevision}
		result := db.Clauses(clause.OnConflict{DoNothing: true}).Create(&row)
		if result.Error != nil {
			return ManagedContextPolicy{}, result.Error
		}
		if result.RowsAffected != 1 {
			return ManagedContextPolicy{}, ErrContextPolicyConflict
		}
		return managedContextPolicy(nextRevision, next), nil
	}
	result := db.Model(&ManagedSetting{}).
		Where("name = ? AND revision = ?", ContextPolicySettingName, expectedRevision).
		Updates(ManagedSetting{Value: string(raw), Revision: nextRevision})
	if result.Error != nil {
		return ManagedContextPolicy{}, result.Error
	}
	if result.RowsAffected != 1 {
		return ManagedContextPolicy{}, ErrContextPolicyConflict
	}
	return managedContextPolicy(nextRevision, next), nil
}

func (p ManagedContextPolicy) ClientProjection() ClientContextPolicy {
	return ClientContextPolicy{
		Revision: p.Revision,
		RuntimeContext: ClientRuntimeContext{
			Enabled:         p.RuntimeContext.Enabled,
			RetrievalBudget: p.RuntimeContext.RetrievalBudget,
			RetrievalOrder:  append([]string(nil), p.RuntimeContext.RetrievalOrder...),
		},
		Learning: ClientLearningPolicy{
			Enabled:            p.Learning.Enabled,
			VisionEnabled:      p.Learning.VisionEnabled,
			AllowedSources:     append([]string(nil), p.Learning.AllowedSources...),
			MaxCallsPerProduct: p.Learning.MaxCallsPerProduct,
			MaxOutputTokens:    p.Learning.MaxOutputTokens,
			RequiresReview:     p.Learning.RequiresReview,
			VideoMode:          p.Learning.VideoMode,
			ASRMode:            p.Learning.ASRMode,
		},
	}
}
