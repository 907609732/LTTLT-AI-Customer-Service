package lingtuhost

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"sort"

	"github.com/QuantumNous/new-api/lingtu"
	"gorm.io/gorm"
)

type clientModel struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}
type modelSelection struct {
	DefaultModel string
	Models       []clientModel
}

func hasModel(models []string, id string) bool {
	for _, model := range models {
		if model == id {
			return true
		}
	}
	return false
}
func (selection modelSelection) allows(id string) bool {
	for _, model := range selection.Models {
		if model.ID == id {
			return true
		}
	}
	return false
}

// imageModel reports the model that image-bearing requests are routed to. The
// server, not the client, decides this: text keeps the policy default/account
// preference, while any request with image parts must be seen by an allowed and
// ready visual model. Models are ID-sorted, so multiple visual connections are
// resolved deterministically without exposing provider routing to the client.
func imageModel(selection modelSelection) (string, bool) {
	for _, model := range selection.Models {
		if channel, err := selectedChannel(model.ID); err == nil && channel.Models == visionModel {
			return model.ID, true
		}
	}
	return "", false
}

// shippedTextPinned identifies the factory text+visual pair. General scoped
// policies keep the documented fallback to another ready allowed model, but the
// shipped pair must never answer text or free summaries with the visual model:
// if DeepSeek is unavailable those requests fail closed before any reservation.
// An administrator's explicit account preference still wins when it is allowed
// and ready, because that is an explicit choice rather than a silent fallback.
func shippedTextPinned(policy lingtu.TrialPolicy) bool {
	factory := lingtu.DefaultTrialPolicy()
	return policy.ModelScope == "selected" && policy.DefaultModel == factory.DefaultModel &&
		len(policy.AllowedModels) == 2 && hasModel(policy.AllowedModels, "deepseek-flash") && hasModel(policy.AllowedModels, visionModel)
}

// Legacy policies intentionally retain their single-model behavior. New scopes
// enumerate only managed bindings, never arbitrary native channels or secrets.
func resolveModelPolicy(db *gorm.DB, policy lingtu.TrialPolicy, accountModel string) (modelSelection, error) {
	if policy.ModelScope == "" {
		selected := accountModel
		if selected == "" {
			selected = policy.DefaultModel
		}
		return modelSelection{DefaultModel: selected, Models: []clientModel{{ID: selected, Name: selected}}}, nil
	}
	if err := validateModelScope(policy); err != nil {
		return modelSelection{}, err
	}
	rows, err := modelConnectionViews(db, policy.DefaultModel)
	if err != nil {
		return modelSelection{}, err
	}
	selection := modelSelection{Models: []clientModel{}}
	for _, row := range rows {
		if !row.Ready || policy.ModelScope == "selected" && !hasModel(policy.AllowedModels, row.ModelID) {
			continue
		}
		selection.Models = append(selection.Models, clientModel{ID: row.ModelID, Name: row.UpstreamModel + " · " + row.Name})
	}
	sort.Slice(selection.Models, func(i, j int) bool { return selection.Models[i].ID < selection.Models[j].ID })
	if len(selection.Models) == 0 {
		return selection, errors.New("no available managed model")
	}
	selection.DefaultModel = selection.Models[0].ID
	if selection.allows(policy.DefaultModel) {
		selection.DefaultModel = policy.DefaultModel
	}
	if selection.allows(accountModel) {
		selection.DefaultModel = accountModel
	}
	if shippedTextPinned(policy) {
		intended := policy.DefaultModel
		if selection.allows(accountModel) {
			intended = accountModel
		}
		selection.DefaultModel = intended
	}
	return selection, nil
}

func validateModelScope(policy lingtu.TrialPolicy) error {
	if policy.ModelScope == "" {
		return nil
	}
	if policy.ModelScope != "all" && policy.ModelScope != "selected" {
		return lingtu.ErrInvalidTrialInput
	}
	if policy.ModelScope == "all" {
		if len(policy.AllowedModels) != 0 {
			return lingtu.ErrInvalidTrialInput
		}
		return nil
	}
	if len(policy.AllowedModels) == 0 || len(policy.AllowedModels) > 512 || !hasModel(policy.AllowedModels, policy.DefaultModel) {
		return lingtu.ErrInvalidTrialInput
	}
	seen := map[string]bool{}
	for _, id := range policy.AllowedModels {
		if !modelIdentifier(id) || seen[id] {
			return lingtu.ErrInvalidTrialInput
		}
		seen[id] = true
	}
	return nil
}

// Saving existing limits is still possible when a previously selected model is
// temporarily unavailable. Newly admitted bindings must be enabled and ready.
func validateModelPolicy(db *gorm.DB, policy lingtu.TrialPolicy) error {
	if err := validateModelScope(policy); err != nil {
		return err
	}
	if policy.ModelScope == "" {
		return nil
	}
	previous, err := lingtu.LoadTrialPolicy(db)
	if err != nil {
		return err
	}
	rows, err := modelConnectionViews(db, policy.DefaultModel)
	if err != nil {
		return err
	}
	candidates := policy.AllowedModels
	if policy.ModelScope == "all" {
		candidates = []string{policy.DefaultModel}
	}
	for _, id := range candidates {
		found, ready := false, false
		for _, row := range rows {
			if row.ModelID == id {
				found, ready = true, row.Ready
				break
			}
		}
		retained := previous.ModelScope == policy.ModelScope && (policy.ModelScope == "all" && previous.DefaultModel == id || policy.ModelScope == "selected" && hasModel(previous.AllowedModels, id))
		// A model the previous policy already allowed may still be unconfigured
		// (for example a fresh install that has only set up DeepSeek). Keeping it
		// in scope is allowed; resolution simply ignores it until it is ready.
		if (!found || !ready) && !retained {
			return lingtu.ErrInvalidTrialInput
		}
	}
	return nil
}

func chatDigest(in chatInput) string {
	canonical, _ := json.Marshal(in.Messages)
	// Preserve the historical digest for old clients. An explicit model,
	// purpose, policy version or learning source must participate in
	// idempotency so one request ID cannot replay a different operation.
	if in.Model != "" || in.Purpose != "" || in.PolicyVersion != nil || in.LearningSource != "" {
		canonical, _ = json.Marshal(struct {
			Model          string        `json:"model,omitempty"`
			Messages       []chatMessage `json:"messages"`
			Purpose        string        `json:"purpose,omitempty"`
			PolicyVersion  *int          `json:"policy_version,omitempty"`
			LearningSource string        `json:"learning_source,omitempty"`
		}{in.Model, in.Messages, in.Purpose, in.PolicyVersion, in.LearningSource})
	}
	digest := sha256.Sum256(canonical)
	return hex.EncodeToString(digest[:])
}
