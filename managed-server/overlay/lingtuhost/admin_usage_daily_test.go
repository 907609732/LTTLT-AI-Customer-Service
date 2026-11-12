package lingtuhost

import (
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/lingtu"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type dailyUsageTestItem struct {
	UsageSummaryTotals
	Date          string `json:"date"`
	Model         string `json:"model"`
	ChannelID     int    `json:"channel_id"`
	ChannelName   string `json:"channel_name"`
	UpstreamModel string `json:"upstream_model"`
}

type dailyUsageTestResponse struct {
	Timezone     string               `json:"timezone"`
	Scope        string               `json:"scope"`
	Days         int                  `json:"days"`
	Model        string               `json:"model"`
	Today        UsageSummaryTotals   `json:"today"`
	Totals       UsageSummaryTotals   `json:"totals"`
	Items        []dailyUsageTestItem `json:"items"`
	ModelOptions []string             `json:"model_options"`
}

func dailyUsageTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db := hostDB(t)
	if err := db.Migrator().DropTable(&managedUsage{}); err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&managedUsage{}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Migrator().DropTable(&managedUsage{}) })
	return db
}

func dailyUsageTestCall(t *testing.T, path string) (*httptest.ResponseRecorder, dailyUsageTestResponse) {
	t.Helper()
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest("GET", path, nil)
	// Exactly Beijing midnight, independent of the host's local timezone.
	(&Host{}).adminUsageDailyAt(c, time.Date(2026, 11, 13, 16, 0, 0, 0, time.UTC))
	var body dailyUsageTestResponse
	if recorder.Code == 200 {
		if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
			t.Fatal(err)
		}
	}
	return recorder, body
}

func TestLingtuAdminUsageDailyBeijingRangeSnapshotsAndKnownCounters(t *testing.T) {
	db := dailyUsageTestDB(t)
	for i, fixture := range []struct {
		utc, model, state, channelName string
		channel, input, output         int
		known, missing                 bool
	}{
		{"2026-10-15T15:59:59Z", "before-thirty", "success", "Old", 1, 999, 999, true, false},
		{"2026-10-15T16:00:00Z", "thirty-model", "success", "Thirty", 4, 4, 6, true, false},
		{"2026-11-07T15:59:59Z", "before-seven", "success", "Old", 1, 999, 999, true, false},
		{"2026-11-07T16:00:00Z", "alpha", "success", "Historical API", 1, 2, 3, true, false},
		{"2026-11-13T15:59:59Z", "alpha", "success", "Historical API", 1, 5, 7, true, false},
		{"2026-11-13T16:00:00Z", "alpha", "success", "Historical API", 1, 10, 20, true, false},
		{"2026-11-13T16:00:01Z", "alpha", "success", "Historical API", 1, 0, 0, true, false},
		{"2026-11-13T16:00:02Z", "alpha", "failed", "Different API", 2, 100, 200, false, false},
		{"2026-11-13T16:00:03Z", "", "uncertain", "", 0, 0, 0, false, true},
		{"2026-11-13T16:00:04Z", "beta", "success", "Beta API", 3, 1, 2, true, false},
		{"2026-11-14T16:00:00Z", "future", "success", "Future API", 5, 999, 999, true, false},
	} {
		at, err := time.Parse(time.RFC3339, fixture.utc)
		if err != nil {
			t.Fatal(err)
		}
		requestID := fmt.Sprintf("daily-%d", i)
		if err := db.Create(&lingtu.TrialRequest{UserID: 1, RequestID: requestID, Digest: "hash", State: fixture.state, CreatedAt: at.Unix()}).Error; err != nil {
			t.Fatal(err)
		}
		if !fixture.missing {
			// Usage timestamp intentionally differs: the request owns the natural day.
			if err := db.Create(&managedUsage{UserID: 1, RequestID: requestID, Model: fixture.model, ChannelID: fixture.channel, ChannelName: fixture.channelName, UpstreamModel: fixture.model + "-actual", InputTokens: fixture.input, OutputTokens: fixture.output, UsageKnown: fixture.known, CreatedAt: at.Add(time.Hour).Unix()}).Error; err != nil {
				t.Fatal(err)
			}
		}
	}
	// Connection probes or orphan usage cannot become actual client requests.
	if err := db.Create(&managedUsage{UserID: 9, RequestID: "probe", Model: "probe-only", InputTokens: 999, UsageKnown: true}).Error; err != nil {
		t.Fatal(err)
	}
	response, body := dailyUsageTestCall(t, "/usage-daily?days=7")
	if response.Code != 200 {
		t.Fatal(response.Code, response.Body.String())
	}
	if body.Timezone != "Asia/Shanghai" || body.Scope != "clients_only" || body.Days != 7 || body.Model != "" || !reflect.DeepEqual(body.ModelOptions, []string{"alpha", "beta"}) {
		t.Fatal(response.Body.String())
	}
	if body.Totals != (UsageSummaryTotals{Requests: 7, Successes: 5, Failed: 1, Uncertain: 1, InputTokens: 18, OutputTokens: 32, TotalTokens: 50, UnknownUsage: 2}) || body.Today != (UsageSummaryTotals{Requests: 5, Successes: 3, Failed: 1, Uncertain: 1, InputTokens: 11, OutputTokens: 22, TotalTokens: 33, UnknownUsage: 2}) {
		t.Fatal(response.Body.String())
	}
	dates := map[string]int64{}
	foundSnapshot, foundUnknown := false, false
	for _, item := range body.Items {
		dates[item.Date] += item.Requests
		if item.Date == "2026-11-14" && item.Model == "alpha" && item.ChannelID == 1 {
			foundSnapshot = item.ChannelName == "Historical API" && item.UpstreamModel == "alpha-actual" && item.Requests == 2 && item.UnknownUsage == 0 && item.InputTokens == 10 && item.OutputTokens == 20
		}
		if item.Date == "2026-11-14" && item.ChannelID == 2 {
			foundUnknown = item.UnknownUsage == 1 && item.InputTokens == 0 && item.OutputTokens == 0 && item.ChannelName == "Different API"
		}
	}
	if !foundSnapshot || !foundUnknown || !reflect.DeepEqual(dates, map[string]int64{"2026-11-08": 1, "2026-11-09": 0, "2026-11-10": 0, "2026-11-11": 0, "2026-11-12": 0, "2026-11-13": 1, "2026-11-14": 5}) {
		t.Fatal(response.Body.String())
	}
	response, body = dailyUsageTestCall(t, "/usage-daily?days=7&model=alpha")
	if response.Code != 200 || body.Model != "alpha" || body.Totals.Requests != 5 || body.Totals.InputTokens != 17 || body.Totals.OutputTokens != 30 || body.Totals.UnknownUsage != 1 || body.Today.Requests != 3 || body.Today.TotalTokens != 30 || body.Today.UnknownUsage != 1 || !reflect.DeepEqual(body.ModelOptions, []string{"alpha", "beta"}) {
		t.Fatal(response.Code, response.Body.String())
	}
	for _, item := range body.Items {
		if item.Requests > 0 && item.Model != "alpha" {
			t.Fatal("model filter leaked", response.Body.String())
		}
	}
	response, body = dailyUsageTestCall(t, "/usage-daily?days=30")
	if response.Code != 200 || body.Days != 30 || body.Totals.Requests != 9 || body.Totals.TotalTokens != 2058 || body.Items[0].Date != "2026-10-16" {
		// Thirty days additionally contains the pre-seven fixture (1998) and thirty-model (10).
		t.Fatal(response.Code, response.Body.String())
	}
}

func TestLingtuAdminUsageDailyEmptyDaysAndExactModel(t *testing.T) {
	db := dailyUsageTestDB(t)
	for _, path := range []string{"/usage-daily", "/usage-daily?days=30", "/usage-daily?model=does-not-exist"} {
		response, body := dailyUsageTestCall(t, path)
		wantDays := 7
		if strings.Contains(path, "30") {
			wantDays = 30
		}
		if response.Code != 200 || body.Days != wantDays || len(body.Items) != wantDays || body.Today.Requests != 0 || body.Totals != (UsageSummaryTotals{}) || body.ModelOptions == nil || len(body.ModelOptions) != 0 {
			t.Fatal(path, response.Code, response.Body.String())
		}
		for _, item := range body.Items {
			if item.UsageSummaryTotals != (UsageSummaryTotals{}) || item.Model != "" || item.ChannelID != 0 || item.ChannelName != "" || item.UpstreamModel != "" {
				t.Fatal(path, response.Body.String())
			}
		}
	}
	if err := db.Create(&lingtu.TrialRequest{UserID: 1, RequestID: "case", Digest: "hash", State: "success", CreatedAt: 1794585600}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&managedUsage{UserID: 1, RequestID: "case", Model: "Alpha", UsageKnown: true}).Error; err != nil {
		t.Fatal(err)
	}
	response, body := dailyUsageTestCall(t, "/usage-daily?model=alpha")
	if response.Code != 200 || body.Totals.Requests != 0 || !reflect.DeepEqual(body.ModelOptions, []string{"Alpha"}) {
		t.Fatal(response.Code, response.Body.String())
	}
}

func TestLingtuAdminUsageDailyRejectsInvalidOrDuplicateParameters(t *testing.T) {
	for _, query := range []string{"days=", "days=0", "days=-7", "days=8", "days=07", "days=7.0", "days=999999999999999999999999", "days=7&days=7", "days=7&days=30", "model=", "model=alpha&model=alpha", "model=alpha&model=beta", "model=%20alpha", "model=alpha%20", "model=alpha%00", "model=" + strings.Repeat("a", 129)} {
		response, _ := dailyUsageTestCall(t, "/usage-daily?"+query)
		if response.Code != 400 {
			t.Fatalf("%s: %d %s", query, response.Code, response.Body.String())
		}
	}
}

func TestLingtuAdminUsageDailyRequiresAdmin(t *testing.T) {
	engine := gin.New()
	(&Host{}).registerAdmin(engine)
	response := httptest.NewRecorder()
	engine.ServeHTTP(response, httptest.NewRequest("GET", "/api/lingtu/admin/usage-daily", nil))
	if response.Code != 401 && response.Code != 403 {
		t.Fatalf("daily usage must retain native admin authorization: %d %s", response.Code, response.Body.String())
	}
}
