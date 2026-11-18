package lingtuhost

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/lingtu"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func managedVisionFixture(t *testing.T, db *gorm.DB, verified bool) (*model.Channel, lingtu.ModelConnection) {
	t.Helper()
	baseURL := "http://127.0.0.1:12345"
	channel := &model.Channel{Name: "fixture-managed-vision", Type: 1, Group: "default", Models: visionModel, BaseURL: &baseURL, Status: common.ChannelStatusEnabled, Key: "fixture-managed-vision-key"}
	if err := db.Create(channel).Error; err != nil {
		t.Fatal(err)
	}
	if err := channel.UpdateAbilities(db); err != nil {
		t.Fatal(err)
	}
	hash := channelHash(*channel)
	row := lingtu.ModelConnection{ChannelID: channel.Id, Provider: "vllm", Name: "Verified image route", ModelID: fmt.Sprintf("managed-vision-%d", channel.Id), Enabled: true, Revision: 1, ConfigHash: hash, TestStatus: "success", TestedHash: hash}
	if verified {
		row.ImageTestStatus = "success"
		row.ImageTestedHash = hash
		row.ImageTestedAt = time.Now().Unix()
	} else {
		row.ImageTestStatus = "never"
	}
	if err := db.Create(&row).Error; err != nil {
		t.Fatal(err)
	}
	model.InitChannelCache()
	return channel, row
}

func saveManagedTrialPolicy(t *testing.T, db *gorm.DB, visionModel string, allowed []string) lingtu.TrialPolicy {
	t.Helper()
	policy := lingtu.DefaultTrialPolicy()
	policy.ModelScope = "selected"
	policy.DefaultModel = "deepseek-flash"
	policy.AllowedModels = allowed
	policy.VisionModel = visionModel
	raw, err := common.Marshal(policy)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Save(&lingtu.ManagedSetting{Name: "trial_policy", Value: string(raw)}).Error; err != nil {
		t.Fatal(err)
	}
	return policy
}

func visionPolicyRequest(policy lingtu.TrialPolicy) configurationRequest {
	return configurationRequest{Section: "trial", Calls: policy.Calls, Days: policy.Days, DailyCalls: policy.DailyCalls, MaxTokens: policy.MaxTokens, Model: policy.DefaultModel, ModelScope: policy.ModelScope, AllowedModels: policy.AllowedModels}
}

func managedVisionRequest(id, model string) string {
	return `{"client_request_id":"` + id + `","model":"` + model + `","messages":[{"role":"user","content":[{"type":"text","text":"describe"},{"type":"image_url","image_url":{"url":"https://images.example.com/fixture.png"}}]}]}`
}

func TestLingtuVisionRouteLegacyAndExplicitCandidates(t *testing.T) {
	db, _ := modelPolicyFixture(t)
	if err := persistManagedModel(&model.Channel{Name: "lingtu-qwen-vision", Type: 1, Group: "default", Models: visionModel, Status: common.ChannelStatusEnabled, Key: "fixture-vision"}, false); err != nil {
		t.Fatal(err)
	}
	legacyPolicy := lingtu.DefaultTrialPolicy()
	legacySelection, err := resolveModelPolicy(db, legacyPolicy, "")
	if err != nil {
		t.Fatal(err)
	}
	legacy, err := visionRoute(legacyPolicy, legacySelection)
	if err != nil || legacy.Model != visionModel || legacy.Channel.Models != visionModel {
		t.Fatalf("legacy route = %+v error=%v", legacy, err)
	}

	_, row := managedVisionFixture(t, db, false)
	policy := saveManagedTrialPolicy(t, db, row.ModelID, []string{"deepseek-flash", row.ModelID})
	selection, err := resolveModelPolicy(db, policy, "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := visionRoute(policy, selection); !errors.Is(err, errVisionUnavailable) {
		t.Fatalf("unverified explicit route error = %v", err)
	}
	if visionRouteAvailable(policy, selection) {
		t.Fatal("unverified explicit route advertised capability")
	}

	row.ImageTestStatus = "success"
	row.ImageTestedHash = row.ConfigHash
	row.ImageTestedAt = time.Now().Unix()
	if err := db.Save(&row).Error; err != nil {
		t.Fatal(err)
	}
	route, err := visionRoute(policy, selection)
	if err != nil || route.Model != row.ModelID || route.Binding.ChannelID != row.ChannelID {
		t.Fatalf("verified explicit route = %+v error=%v", route, err)
	}
	if !visionRouteAvailable(policy, selection) {
		t.Fatal("verified explicit route was not advertised")
	}

	unauthorized := policy
	unauthorized.AllowedModels = []string{"deepseek-flash"}
	unauthorizedSelection, err := resolveModelPolicy(db, unauthorized, "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := visionRoute(unauthorized, unauthorizedSelection); !errors.Is(err, errVisionUnavailable) {
		t.Fatalf("unauthorized route error = %v", err)
	}
	if visionRouteAvailable(unauthorized, unauthorizedSelection) {
		t.Fatal("unauthorized explicit route advertised capability")
	}
}

func TestLingtuVisionExplicitRouteFailsBeforeReservation(t *testing.T) {
	for _, test := range []struct {
		name   string
		mutate func(t *testing.T, db *gorm.DB, row *lingtu.ModelConnection, channel *model.Channel)
	}{
		{name: "unverified", mutate: func(t *testing.T, db *gorm.DB, row *lingtu.ModelConnection, _ *model.Channel) {
			row.ImageTestStatus, row.ImageTestedHash, row.ImageTestedAt = "never", "", 0
			if err := db.Save(row).Error; err != nil {
				t.Fatal(err)
			}
		}},
		{name: "stale-config", mutate: func(t *testing.T, db *gorm.DB, _ *lingtu.ModelConnection, channel *model.Channel) {
			if err := db.Model(&model.Channel{}).Where("id = ?", channel.Id).Update("key", "rotated-secret").Error; err != nil {
				t.Fatal(err)
			}
		}},
		{name: "disabled", mutate: func(t *testing.T, db *gorm.DB, _ *lingtu.ModelConnection, channel *model.Channel) {
			if err := db.Model(&model.Channel{}).Where("id = ?", channel.Id).Update("status", common.ChannelStatusManuallyDisabled).Error; err != nil {
				t.Fatal(err)
			}
		}},
	} {
		t.Run(test.name, func(t *testing.T) {
			db := managedModelDB(t)
			if err := persistManagedModel(&model.Channel{Name: "lingtu-deepseek", Type: 1, Group: "default", Models: "deepseek-flash", Status: common.ChannelStatusEnabled, Key: "fixture-deepseek"}, false); err != nil {
				t.Fatal(err)
			}
			channel, row := managedVisionFixture(t, db, true)
			saveManagedTrialPolicy(t, db, row.ModelID, []string{"deepseek-flash", row.ModelID})
			test.mutate(t, db, &row, channel)
			model.InitChannelCache()

			h := &Host{trials: lingtu.NewTrialStore(db)}
			if err := h.migrateChat(); err != nil {
				t.Fatal(err)
			}
			seedManagedChatIdentity(t, db)
			if err := lingtu.EnsureManagedAccount(db, 99, time.Now()); err != nil {
				t.Fatal(err)
			}
			dispatched := 0
			router := gin.New()
			router.POST("/chat", func(c *gin.Context) { c.Set("lingtu_identity", lingtu.ClientIdentity{UserID: 99}) }, h.prepareChat, func(c *gin.Context) {
				dispatched++
				c.AbortWithStatus(500)
			})
			recorder := httptest.NewRecorder()
			router.ServeHTTP(recorder, httptest.NewRequest("POST", "/chat", strings.NewReader(managedVisionRequest("vision-"+test.name, "deepseek-flash"))))
			if recorder.Code != 400 || !strings.Contains(recorder.Body.String(), `"error":"vision_unavailable"`) {
				t.Fatalf("invalid explicit route = %d: %s", recorder.Code, recorder.Body.String())
			}
			if dispatched != 0 {
				t.Fatal("invalid visual route reached upstream")
			}
			var requests int64
			if err := db.Model(&lingtu.TrialRequest{}).Count(&requests).Error; err != nil || requests != 0 {
				t.Fatalf("invalid route created requests=%d error=%v", requests, err)
			}
			var grant lingtu.TrialGrant
			if err := db.First(&grant, 99).Error; err != nil || grant.Used != 0 || grant.Reserved != 0 {
				t.Fatalf("invalid route changed ledger: %+v error=%v", grant, err)
			}
		})
	}
}

func TestLingtuVisionExplicitRouteIgnoresClientModelAndRecordsActualUsage(t *testing.T) {
	db := managedModelDB(t)
	if err := persistManagedModel(&model.Channel{Name: "lingtu-deepseek", Type: 1, Group: "default", Models: "deepseek-flash", Status: common.ChannelStatusEnabled, Key: "fixture-deepseek"}, false); err != nil {
		t.Fatal(err)
	}
	_, row := managedVisionFixture(t, db, true)
	saveManagedTrialPolicy(t, db, row.ModelID, []string{"deepseek-flash", row.ModelID})
	model.InitChannelCache()
	loaded, err := lingtu.LoadTrialPolicy(db)
	if err != nil {
		t.Fatal(err)
	}
	if loaded.VisionModel != row.ModelID {
		t.Fatalf("saved visual route = %+v, want %q", loaded, row.ModelID)
	}
	selection, err := resolveModelPolicy(db, loaded, "")
	if err != nil || !selection.allows(row.ModelID) {
		t.Fatalf("visual route missing from selection: %+v error=%v", selection, err)
	}

	vault, err := lingtu.RuntimeVault()
	if err != nil {
		t.Fatal(err)
	}
	sessions := lingtu.NewSessionStore(db, vault, "https://api.test", func(int, string, int64) error { return nil })
	if err := sessions.Migrate(); err != nil {
		t.Fatal(err)
	}
	h := &Host{trials: lingtu.NewTrialStore(db), sessions: sessions}
	if err := h.migrateChat(); err != nil {
		t.Fatal(err)
	}
	seedManagedChatIdentity(t, db)
	if err := lingtu.EnsureManagedAccount(db, 99, time.Now()); err != nil {
		t.Fatal(err)
	}
	bundle, err := sessions.Create(99, "managed-vision-route", 1, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	dispatched := []string{}
	router := gin.New()
	router.POST("/chat", h.clientAuth, h.prepareChat, func(c *gin.Context) {
		raw, err := io.ReadAll(c.Request.Body)
		if err != nil {
			t.Error(err)
			c.AbortWithStatus(500)
			return
		}
		var body struct {
			Model    string        `json:"model"`
			Messages []chatMessage `json:"messages"`
		}
		if err := json.Unmarshal(raw, &body); err != nil || !containsImages(body.Messages) {
			t.Errorf("admitted request lost image: %s error=%v", raw, err)
		}
		dispatched = append(dispatched, body.Model)
		c.Set("lingtu_upstream_started", true)
		c.Set("lingtu_upstream_status", 200)
		c.Set("lingtu_provider_usage_seen", true)
		c.Set("lingtu_provider_usage_known", true)
		c.Set("lingtu_provider_input_tokens", 3)
		c.Set("lingtu_provider_output_tokens", 5)
		c.JSON(200, gin.H{"choices": []gin.H{{"message": gin.H{"content": "vision fixture answer"}}}, "usage": gin.H{"prompt_tokens": 3, "completion_tokens": 5}})
	})
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest("POST", "/chat", strings.NewReader(managedVisionRequest("explicit-route", "deepseek-flash")))
	request.Header.Set("Authorization", "Bearer "+bundle.AccessToken)
	router.ServeHTTP(recorder, request)
	if recorder.Code != 200 {
		t.Fatalf("verified route response = %d: %s", recorder.Code, recorder.Body.String())
	}
	if len(dispatched) != 1 || dispatched[0] != visionModel || dispatched[0] == "deepseek-flash" {
		t.Fatalf("client model overrode visual route: %v", dispatched)
	}
	var usage managedUsage
	if err := db.First(&usage, "user_id = ? AND request_id = ?", 99, "explicit-route").Error; err != nil {
		t.Fatal(err)
	}
	if usage.Model != row.ModelID || usage.UpstreamModel != visionModel || usage.ChannelID != row.ChannelID || usage.Diagnostic != "success" {
		t.Fatalf("usage did not pin actual visual route: %+v", usage)
	}
	var grant lingtu.TrialGrant
	if err := db.First(&grant, 99).Error; err != nil || grant.Used != 1 || grant.Reserved != 0 {
		t.Fatalf("successful visual request ledger = %+v error=%v", grant, err)
	}
}

func TestLingtuVisionPolicySaveRequiresVerifiedAuthorizedCandidate(t *testing.T) {
	db := managedModelDB(t)
	if err := persistManagedModel(&model.Channel{Name: "lingtu-deepseek", Type: 1, Group: "default", Models: "deepseek-flash", Status: common.ChannelStatusEnabled, Key: "fixture-deepseek"}, false); err != nil {
		t.Fatal(err)
	}
	_, row := managedVisionFixture(t, db, false)
	base := saveManagedTrialPolicy(t, db, "", []string{"deepseek-flash", row.ModelID})
	h := &Host{}

	unverified := base.VisionModel
	unverified = row.ModelID
	request := visionPolicyRequest(base)
	request.VisionModel = &unverified
	if err := h.saveTrialConfiguration(request); err == nil {
		t.Fatal("unverified image candidate was saved")
	}
	after, err := lingtu.LoadTrialPolicy(db)
	if err != nil || after.VisionModel != "" {
		t.Fatalf("failed save changed policy: %+v error=%v", after, err)
	}

	row.ImageTestStatus = "success"
	row.ImageTestedHash = row.ConfigHash
	row.ImageTestedAt = time.Now().Unix()
	if err := db.Save(&row).Error; err != nil {
		t.Fatal(err)
	}
	request = visionPolicyRequest(base)
	request.VisionModel = &unverified
	if err := h.saveTrialConfiguration(request); err != nil {
		t.Fatal(err)
	}
	after, _ = lingtu.LoadTrialPolicy(db)
	if after.VisionModel != row.ModelID {
		t.Fatalf("verified candidate not saved: %+v", after)
	}

	request = visionPolicyRequest(after)
	request.VisionModel = nil
	request.DailyCalls++
	if err := h.saveTrialConfiguration(request); err != nil {
		t.Fatal(err)
	}
	after, _ = lingtu.LoadTrialPolicy(db)
	if after.VisionModel != row.ModelID {
		t.Fatal("omitted vision_model did not preserve")
	}

	empty := ""
	request = visionPolicyRequest(after)
	request.VisionModel = &empty
	if err := h.saveTrialConfiguration(request); err != nil {
		t.Fatal(err)
	}
	after, _ = lingtu.LoadTrialPolicy(db)
	if after.VisionModel != "" {
		t.Fatal("explicit clear did not clear vision_model")
	}

	unauthorized := row.ModelID
	request = visionPolicyRequest(base)
	request.AllowedModels = []string{"deepseek-flash"}
	request.VisionModel = &unauthorized
	if err := h.saveTrialConfiguration(request); err == nil {
		t.Fatal("unauthorized image candidate was saved")
	}
}

func TestLingtuVisionImageVerificationIsIsolatedAndCASGuarded(t *testing.T) {
	db := managedModelDB(t)
	channel, row := managedVisionFixture(t, db, false)
	if err := db.AutoMigrate(&managedUsage{}); err != nil {
		t.Fatal(err)
	}
	var usages int64
	countUsage := func() int64 {
		t.Helper()
		if err := db.Model(&managedUsage{}).Count(&usages).Error; err != nil {
			t.Fatal(err)
		}
		return usages
	}
	var chanStatus, testTime = channel.Status, channel.TestTime
	host := &Host{imageProbe: func(context.Context, *model.Channel, int) error { return nil }}
	request := configurationRequest{Section: "model_connection", Provider: "vllm", Action: "verify_vision", ConnectionID: channel.Id, Revision: row.Revision, ConfigHash: row.ConfigHash}
	if err := host.executeModelConnection(nil, request, nil); err != nil {
		t.Fatal(err)
	}
	var verified lingtu.ModelConnection
	if err := db.First(&verified, row.ChannelID).Error; err != nil {
		t.Fatal(err)
	}
	if verified.ImageTestStatus != "success" || verified.ImageTestedHash != verified.ConfigHash || verified.ImageTestedAt <= 0 || verified.TestStatus != "success" {
		t.Fatalf("image verification record = %+v", verified)
	}
	var native model.Channel
	if err := db.First(&native, channel.Id).Error; err != nil {
		t.Fatal(err)
	}
	if native.Status != chanStatus || native.TestTime != testTime {
		t.Fatalf("image verification changed native channel: status=%d test=%d", native.Status, native.TestTime)
	}
	if countUsage() != 0 {
		t.Fatal("image verification created managed usage")
	}
	var trialRequests int64
	if err := db.Model(&lingtu.TrialRequest{}).Count(&trialRequests).Error; err != nil || trialRequests != 0 {
		t.Fatalf("image verification created trial requests=%d error=%v", trialRequests, err)
	}

	// A changed native configuration during the probe must reject the stale result.
	host = &Host{imageProbe: func(context.Context, *model.Channel, int) error {
		return db.Model(&model.Channel{}).Where("id = ?", channel.Id).Update("key", "rotated-during-probe").Error
	}}
	stale := request
	stale.Revision = verified.Revision
	stale.ConfigHash = verified.ConfigHash
	if err := host.executeModelConnection(nil, stale, nil); !errors.Is(err, errVisionVerificationStale) {
		t.Fatalf("stale image probe error = %v", err)
	}
	var afterStale lingtu.ModelConnection
	if err := db.First(&afterStale, row.ChannelID).Error; err != nil {
		t.Fatal(err)
	}
	if afterStale.ImageTestedHash != verified.ImageTestedHash || afterStale.ImageTestedAt != verified.ImageTestedAt {
		t.Fatal("stale image result overwrote current verification")
	}

	// A failed probe records the failure but never disables the text connection.
	goodChannel, goodRow := managedVisionFixture(t, db, false)
	host = &Host{imageProbe: func(context.Context, *model.Channel, int) error { return errors.New("fixture image rejected") }}
	failed := configurationRequest{Section: "model_connection", Provider: "vllm", Action: "verify_vision", ConnectionID: goodChannel.Id, Revision: goodRow.Revision, ConfigHash: goodRow.ConfigHash}
	if err := host.executeModelConnection(nil, failed, nil); !errors.Is(err, errVisionVerificationFailed) {
		t.Fatalf("failed probe error = %v", err)
	}
	var failedRow lingtu.ModelConnection
	if err := db.First(&failedRow, goodRow.ChannelID).Error; err != nil {
		t.Fatal(err)
	}
	if failedRow.ImageTestStatus != "failed" || failedRow.TestStatus != "success" {
		t.Fatalf("failed image probe changed text status: %+v", failedRow)
	}

	// A successful text probe cannot grant image capability.
	textChannel, textRow := managedVisionFixture(t, db, false)
	host = &Host{}
	textRequest := configurationRequest{Section: "model_connection", Provider: "vllm", Action: "test", ConnectionID: textChannel.Id, Revision: textRow.Revision}
	if err := host.executeModelConnection(nil, textRequest, func(context.Context, *model.Channel, int) error { return nil }); err != nil {
		t.Fatal(err)
	}
	var textVerified lingtu.ModelConnection
	if err := db.First(&textVerified, textRow.ChannelID).Error; err != nil {
		t.Fatal(err)
	}
	if textVerified.TestStatus != "success" || textVerified.ImageTestStatus != "never" || textVerified.ImageTestedHash != "" {
		t.Fatalf("text probe granted image verification: %+v", textVerified)
	}
}

func TestLingtuVisionConfigurationChangesInvalidateImageVerification(t *testing.T) {
	db := managedModelDB(t)
	channel, row := managedVisionFixture(t, db, true)
	views, err := modelConnectionViews(db, "deepseek-flash")
	if err != nil {
		t.Fatal(err)
	}
	var found *modelConnectionView
	for i := range views {
		if views[i].ConnectionID == row.ChannelID {
			found = &views[i]
		}
	}
	if found == nil || !found.VisionVerified || !found.VisionReady || found.ImageTestStatus != "success" {
		t.Fatalf("verified view = %+v", found)
	}
	if err := db.Model(&model.Channel{}).Where("id = ?", channel.Id).Update("key", "rotated-key").Error; err != nil {
		t.Fatal(err)
	}
	views, err = modelConnectionViews(db, "deepseek-flash")
	if err != nil {
		t.Fatal(err)
	}
	if views[0].VisionVerified || views[0].VisionReady || views[0].ImageTestStatus != "stale" {
		t.Fatalf("key change did not stale image verification: %+v", views[0])
	}
	channel.Key = "rotated-key"
	if err := db.Save(channel).Error; err != nil {
		t.Fatal(err)
	}
	model.InitChannelCache()
}
