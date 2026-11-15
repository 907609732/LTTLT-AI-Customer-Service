package lingtuhost

import (
	"encoding/json"
	"github.com/QuantumNous/new-api/lingtu"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestLingtuCNYRatesAndSnapshots(t *testing.T) {
	for _, bad := range []string{"-1", "1e3", "NaN", "1000000", "0.1234567", " 1"} {
		if _, err := normalizeCostRate(bad); err == nil {
			t.Fatalf("accepted %q", bad)
		}
	}
	rate := lingtu.ModelConnection{ChannelID: 1, CostRateModel: "qwen", InputCNY: "1", OutputCNY: "10"}
	current := map[int]lingtu.ModelConnection{1: rate}
	record := usageDailyRecord{ChannelID: 1, UpstreamModel: "qwen", UsageKnown: true, InputTokens: 1565, OutputTokens: 499}
	got := estimateCNY(record, current)
	if got.CNY != "0.006555" || got.Basis != "current_rates" {
		t.Fatalf("historical: %+v", got)
	}
	record.CostSnapshot = true
	if got := estimateCNY(record, current); got.Basis != "unpriced" {
		t.Fatalf("retroactively priced missing snapshot: %+v", got)
	}
	record.CostInputCNY, record.CostOutputCNY = "2", "8"
	if got := estimateCNY(record, current); got.CNY != "0.007122" || got.Basis != "snapshot" {
		t.Fatalf("snapshot: %+v", got)
	}
	record.UsageKnown = false
	if got := estimateCNY(record, current); got.Basis != "unpriced" {
		t.Fatalf("unknown usage: %+v", got)
	}
	record.UsageKnown = true
	record.CostInputCNY, record.CostOutputCNY = "0", "0"
	if got := estimateCNY(record, current); got.CNY != "0" || got.Basis != "snapshot" {
		t.Fatalf("zero: %+v", got)
	}
	record.CostSnapshot = false
	record.UpstreamModel = "different"
	if got := estimateCNY(record, current); got.Basis != "unpriced" {
		t.Fatalf("model mismatch: %+v", got)
	}
}

func TestLingtuCNYUsageViewsAgreeAndKeepUnknown(t *testing.T) {
	db := dailyUsageTestDB(t)
	rate := lingtu.ModelConnection{ChannelID: 7, Provider: "qwen", Name: "fixture", ModelID: "managed-7", CostRateModel: "qwen", InputCNY: "1", OutputCNY: "10"}
	if err := db.Create(&rate).Error; err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 11, 14, 1, 0, 0, 0, time.UTC).Unix()
	for _, id := range []string{"frozen", "historical", "unknown"} {
		if err := db.Create(&lingtu.TrialRequest{UserID: 91, RequestID: id, Digest: "fixture", State: "success", CreatedAt: now}).Error; err != nil {
			t.Fatal(err)
		}
		usage := managedUsage{UserID: 91, RequestID: id, ChannelID: 7, UpstreamModel: "qwen", InputTokens: 1565, OutputTokens: 499, UsageKnown: id != "unknown"}
		if id == "frozen" {
			usage.CostSnapshot = true
			usage.CostInputCNY = "2"
			usage.CostOutputCNY = "8"
		}
		if err := db.Create(&usage).Error; err != nil {
			t.Fatal(err)
		}
	}
	for _, summary := range []bool{false, true} {
		recorder := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(recorder)
		c.Request = httptest.NewRequest("GET", "/?user_id=91", nil)
		if summary {
			(&Host{}).adminUsageSummary(c)
		} else {
			(&Host{}).adminUsage(c)
		}
		if recorder.Code != 200 {
			t.Fatalf("%d %s", recorder.Code, recorder.Body.String())
		}
		if summary {
			var result struct {
				Totals UsageSummaryTotals `json:"totals"`
			}
			json.Unmarshal(recorder.Body.Bytes(), &result)
			if result.Totals.EstimatedCNY != "0.013677" || result.Totals.UnpricedRequests != 1 || result.Totals.CurrentRateRequests != 1 {
				t.Fatalf("summary: %s", recorder.Body.String())
			}
		} else {
			var result struct {
				Items []struct {
					RequestID string `json:"request_id"`
					Cost      string `json:"estimated_cny"`
					Basis     string `json:"cost_basis"`
				} `json:"items"`
			}
			json.Unmarshal(recorder.Body.Bytes(), &result)
			for _, row := range result.Items {
				if row.RequestID == "frozen" && (row.Cost != "0.007122" || row.Basis != "snapshot") {
					t.Fatalf("request: %s", recorder.Body.String())
				}
			}
		}
	}
	recorder, result := dailyUsageTestCall(t, "/?days=7")
	if recorder.Code != 200 || result.Totals.EstimatedCNY != "0.013677" || result.Totals.UnpricedRequests != 1 {
		t.Fatalf("daily: %s", recorder.Body.String())
	}
}

func TestLingtuCNYConfigRetainsRatesForOldClientsAndRejectsPartialRates(t *testing.T) {
	db := managedModelDB(t)
	putModelPolicy(t, db)
	h := &Host{}
	r := configurationRequest{Provider: "deepseek", Action: "save", Name: "fixture", BaseURL: "https://api.deepseek.com", UpstreamModel: "deepseek-chat", Secret: "fixture-secret", CostRates: &costRatesRequest{InputCNY: "1", OutputCNY: "10"}}
	if err := h.saveModelConnection(nil, r); err != nil {
		t.Fatal(err)
	}
	var row lingtu.ModelConnection
	db.First(&row)
	r.ConnectionID, r.Revision, r.Secret = row.ChannelID, row.Revision, ""
	r.CostRates = &costRatesRequest{InputCNY: "2"}
	if err := h.saveModelConnection(nil, r); err == nil {
		t.Fatal("partial rates accepted")
	}
	r.CostRates = nil
	if err := h.saveModelConnection(nil, r); err != nil {
		t.Fatal(err)
	}
	db.First(&row)
	if row.InputCNY != "1" || row.OutputCNY != "10" {
		t.Fatal("old client erased rates")
	}
}

func TestLingtuCNYLegacySavePreservesRates(t *testing.T) {
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
	if err := db.Model(&lingtu.ModelConnection{}).Where("channel_id = ?", old.Id).Updates(map[string]interface{}{"cost_rate_model": old.Models, "input_cny": "1", "output_cny": "10"}).Error; err != nil {
		t.Fatal(err)
	}
	old.Key = "legacy-replacement"
	if err := persistManagedModel(old, true); err != nil {
		t.Fatal(err)
	}
	var row lingtu.ModelConnection
	db.First(&row, old.Id)
	if row.CostRateModel != old.Models || row.InputCNY != "1" || row.OutputCNY != "10" {
		t.Fatalf("legacy erased rates: %+v", row)
	}
}

func TestLingtuCNYAccountAggregationAvoidsUngroupedUsageColumns(t *testing.T) {
	db := dailyUsageTestDB(t)
	sql := db.ToSQL(func(tx *gorm.DB) *gorm.DB {
		// The production aggregate keeps per-request prices in the separate decimal stream.
		return usageAccountAggregate(0).Session(&gorm.Session{DryRun: true}).Find(&[]usageAccountSummary{})
	})
	if !strings.Contains(sql, "GROUP BY") || !strings.Contains(sql, "SUM(") || strings.Contains(sql, "cost_snapshot") || strings.Contains(sql, "AS channel_id") {
		t.Fatal(sql)
	}
}
