package lingtuhost

import (
	"encoding/json"
	"fmt"
	"github.com/QuantumNous/new-api/relay/channel/openai"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relaykit/types"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/lingtu"
	"github.com/gin-gonic/gin"
)

func TestLingtuAdminUsageSummaryGroupsAndDistinguishesUnknown(t *testing.T) {
	db := hostDB(t)
	if err := db.Migrator().DropTable(&managedUsage{}); err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&managedUsage{}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Migrator().DropTable(&managedUsage{}) })
	for _, u := range []accountUserFixture{{ID: 1, DisplayName: "First"}, {ID: 2, DisplayName: "Second"}} {
		if err := db.Create(&u).Error; err != nil {
			t.Fatal(err)
		}
	}
	for _, r := range []lingtu.TrialRequest{{UserID: 1, RequestID: "success", Digest: "hash", State: "success", CreatedAt: 100}, {UserID: 1, RequestID: "zero", Digest: "hash", State: "success", CreatedAt: 110}, {UserID: 1, RequestID: "legacy", Digest: "hash", State: "failed", CreatedAt: 120}, {UserID: 2, RequestID: "missing", Digest: "hash", State: "uncertain", CreatedAt: 200}, {UserID: 2, RequestID: "oldzero", Digest: "hash", State: "failed", CreatedAt: 190}} {
		if err := db.Create(&r).Error; err != nil {
			t.Fatal(err)
		}
	}
	for _, u := range []managedUsage{{UserID: 1, RequestID: "success", InputTokens: 10, OutputTokens: 4, UsageKnown: true}, {UserID: 1, RequestID: "zero", UsageKnown: true}, {UserID: 1, RequestID: "legacy", InputTokens: 3, OutputTokens: 2}, {UserID: 2, RequestID: "oldzero"}} {
		if err := db.Create(&u).Error; err != nil {
			t.Fatal(err)
		}
	}
	invoke := func(path string, summary bool) *httptest.ResponseRecorder {
		t.Helper()
		r := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(r)
		c.Request = httptest.NewRequest("GET", path, nil)
		if summary {
			(&Host{}).adminUsageSummary(c)
		} else {
			(&Host{}).adminUsage(c)
		}
		return r
	}
	response := invoke("/usage-summary", true)
	if response.Code != 200 {
		t.Fatal(response.Code, response.Body.String())
	}
	var body struct {
		Totals usageSummaryTotals    `json:"totals"`
		Items  []usageAccountSummary `json:"items"`
		Total  int64                 `json:"total"`
		Page   int                   `json:"page"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.Total != 2 || len(body.Items) != 2 || body.Items[0].UserID != 2 || body.Totals.Requests != 5 || body.Totals.Successes != 2 || body.Totals.Failed != 2 || body.Totals.Uncertain != 1 || body.Totals.InputTokens != 10 || body.Totals.OutputTokens != 4 || body.Totals.TotalTokens != 14 || body.Totals.UnknownUsage != 3 {
		t.Fatal(response.Body.String())
	}
	if body.Items[1].DisplayName != "First" || body.Items[1].UnknownUsage != 1 || body.Items[1].LastUsedAt != 120 {
		t.Fatal(response.Body.String())
	}
	response = invoke("/usage-summary?user_id=1", true)
	if response.Code != 200 || !strings.Contains(response.Body.String(), `"requests":3`) || strings.Contains(response.Body.String(), "Second") {
		t.Fatal(response.Code, response.Body.String())
	}
	response = invoke("/usage?user_id=1", false)
	if response.Code != 200 || !strings.Contains(response.Body.String(), `"display_name":"First"`) || !strings.Contains(response.Body.String(), `"usage_known":true`) || !strings.Contains(response.Body.String(), `"total_tokens":14`) || strings.Contains(response.Body.String(), "Second") {
		t.Fatal(response.Code, response.Body.String())
	}
	response = invoke("/usage?user_id=2", false)
	if response.Code != 200 || !strings.Contains(response.Body.String(), `"usage_known":false`) {
		t.Fatal(response.Code, response.Body.String())
	}
	for _, path := range []string{"/usage?user_id=0", "/usage?user_id=-1", "/usage?user_id=abc", "/usage-summary?user_id=0", "/usage-summary?user_id=1.0", "/usage-summary?user_id=", "/usage-summary?page=zero"} {
		response = invoke(path, strings.HasPrefix(path, "/usage-summary"))
		if response.Code != 400 {
			t.Fatal(path, response.Code, response.Body.String())
		}
	}
}

func TestLingtuAdminAccountsIncludesNativeRootWithoutGrant(t *testing.T) {
	db := hostDB(t)
	if err := db.Create(&accountUserFixture{ID: 1, Username: "root", Role: 100, Status: 1}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&accountUserFixture{ID: 2, Username: "other", DisplayName: "Other", Status: 1}).Error; err != nil {
		t.Fatal(err)
	}
	call := func(path string) *httptest.ResponseRecorder {
		r := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(r)
		c.Request = httptest.NewRequest("GET", path, nil)
		(&Host{}).adminAccounts(c)
		return r
	}
	response := call("/accounts?query=root")
	if response.Code != 200 || !strings.Contains(response.Body.String(), `"display_name":"root"`) || !strings.Contains(response.Body.String(), `"status":"not_authorized"`) || !strings.Contains(response.Body.String(), `"limit":0`) || strings.Contains(response.Body.String(), "Other") {
		t.Fatal(response.Code, response.Body.String())
	}
	var count int64
	db.Model(&lingtu.ManagedAccount{}).Count(&count)
	if count != 0 {
		t.Fatal("GET created managed account")
	}
	db.Model(&lingtu.TrialGrant{}).Count(&count)
	if count != 0 {
		t.Fatal("GET granted trial")
	}
	if err := (&Host{}).saveAccount(configurationRequest{UserID: 1, Calls: 20, Status: "enabled", ExpiresAt: 2000000000, Reason: "Explicit administrator authorization"}); err != nil {
		t.Fatal(err)
	}
	var grant lingtu.TrialGrant
	if err := db.First(&grant, 1).Error; err != nil || grant.Limit != 20 {
		t.Fatal(grant, err)
	}
	if err := db.Model(&grant).Updates(map[string]any{"used": 3, "reserved": 1}).Error; err != nil {
		t.Fatal(err)
	}
	if err := (&Host{}).saveAccount(configurationRequest{UserID: 1, Calls: 25, Status: "enabled", ExpiresAt: 2000000001, Reason: "Explicit administrator adjustment"}); err != nil {
		t.Fatal(err)
	}
	grant = lingtu.TrialGrant{}
	if err := db.First(&grant, 1).Error; err != nil || grant.Limit != 25 || grant.Used != 3 || grant.Reserved != 1 {
		t.Fatal(grant, err)
	}
	if err := db.Model(&accountUserFixture{}).Where("id = ?", 2).UpdateColumn("status", 2).Error; err != nil {
		t.Fatal(err)
	}
	if err := (&Host{}).saveAccount(configurationRequest{UserID: 2, Calls: 20, Status: "enabled", ExpiresAt: 2000000000, Reason: "Cannot bypass native disable"}); err == nil {
		t.Fatal("disabled native account enabled via managed grant")
	}
	if err := db.Delete(&accountUserFixture{}, 2).Error; err != nil {
		t.Fatal(err)
	}
	if response = call("/accounts"); response.Code != 200 || strings.Contains(response.Body.String(), "Other") {
		t.Fatal(response.Code, response.Body.String())
	}
}

func TestLingtuAdminUsagePaginationAndProtectedRoute(t *testing.T) {
	db := hostDB(t)
	if err := db.Migrator().DropTable(&managedUsage{}); err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&managedUsage{}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Migrator().DropTable(&managedUsage{}) })
	for i := 1; i <= 23; i++ {
		if err := db.Create(&accountUserFixture{ID: i, Username: fmt.Sprintf("user%d", i)}).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&lingtu.TrialRequest{UserID: i, RequestID: "one", Digest: "hash", State: "success", CreatedAt: int64(i)}).Error; err != nil {
			t.Fatal(err)
		}
	}
	for _, summary := range []bool{false, true} {
		var pages [2][]map[string]any
		for page := 1; page <= 2; page++ {
			r := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(r)
			c.Request = httptest.NewRequest("GET", fmt.Sprintf("/usage?page=%d", page), nil)
			if summary {
				(&Host{}).adminUsageSummary(c)
			} else {
				(&Host{}).adminUsage(c)
			}
			if r.Code != 200 {
				t.Fatal(r.Code, r.Body.String())
			}
			var body struct {
				Items []map[string]any `json:"items"`
				Total int              `json:"total"`
			}
			if err := json.Unmarshal(r.Body.Bytes(), &body); err != nil || body.Total != 23 {
				t.Fatal(r.Body.String(), err)
			}
			pages[page-1] = body.Items
		}
		if len(pages[0]) != 20 || len(pages[1]) != 3 || pages[0][0]["user_id"] != float64(23) || pages[1][0]["user_id"] != float64(3) {
			t.Fatal(summary, pages)
		}
	}
	engine := gin.New()
	(&Host{}).registerAdmin(engine)
	response := httptest.NewRecorder()
	engine.ServeHTTP(response, httptest.NewRequest("GET", "/api/lingtu/admin/usage-summary", nil))
	if response.Code != 401 && response.Code != 403 {
		t.Fatal("unprotected summary route", response.Code, response.Body.String())
	}
}

func TestLingtuRawProviderUsageSurvivesNativeEstimation(t *testing.T) {
	for _, test := range []struct {
		name, usage   string
		known         bool
		input, output int
	}{{"omitted", "", false, 0, 0}, {"zero", `,"usage":{"prompt_tokens":0,"completion_tokens":0}`, true, 0, 0}, {"reported", `,"usage":{"prompt_tokens":2,"completion_tokens":3}`, true, 2, 3}} {
		t.Run(test.name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(recorder)
			c.Request = httptest.NewRequest("POST", "/v1/chat/completions", nil)
			c.Set("lingtu_internal", true)
			raw := `{"model":"qwen-plus","choices":[{"message":{"role":"assistant","content":"safe answer"},"finish_reason":"stop"}]` + test.usage + `}`
			info := &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{ChannelType: 1, UpstreamModelName: "qwen-plus"}, RelayFormat: types.RelayFormatOpenAI}
			response := &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(raw))}
			if _, err := openai.OpenaiHandler(c, info, response); err != nil {
				t.Fatal(err)
			}
			if !c.GetBool("lingtu_provider_usage_seen") || c.GetBool("lingtu_provider_usage_known") != test.known {
				t.Fatal("raw provenance lost before native estimates", c.Keys)
			}
			source := &managedTokenUsage{Input: c.GetInt("lingtu_provider_input_tokens"), Output: c.GetInt("lingtu_provider_output_tokens"), Known: c.GetBool("lingtu_provider_usage_known")}
			clean, input, output, known := sanitizeManagedResponse(recorder.Body.Bytes(), "qwen-plus", source)
			if len(clean) == 0 || input != test.input || output != test.output || known != test.known {
				t.Fatal(string(clean), input, output, known)
			}
			if !test.known && strings.Contains(string(clean), `"usage"`) {
				t.Fatal("invented usage for omitted provider counters", string(clean))
			}
		})
	}
	// No provenance hook must never promote mature-relay estimates to provider facts.
	clean, input, output, known := sanitizeManagedResponse([]byte(`{"choices":[{"message":{"content":"answer"}}],"usage":{"prompt_tokens":10,"completion_tokens":20}}`), "qwen-plus", &managedTokenUsage{})
	if len(clean) == 0 || known || input != 0 || output != 0 || strings.Contains(string(clean), `"usage"`) {
		t.Fatal(string(clean), input, output, known)
	}
}
