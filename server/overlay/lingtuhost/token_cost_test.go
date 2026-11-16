package lingtuhost

import (
	"context"
	"encoding/json"
	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/lingtu"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"net/http/httptest"
	"testing"
)

func fixtureCostPrice(s string) *string { return &s }
func TestLingtuConnectionCostPricesPersistAndVersionWithoutRetest(t *testing.T) {
	db := managedModelDB(t)
	h := &Host{}
	request := configurationRequest{Section: "model_connection", Action: "save", Provider: "vllm", Name: "cost fixture", BaseURL: "http://127.0.0.1:12345", UpstreamModel: "fixture", Enabled: true, TestAfterSave: true, CostRates: &costRatesRequest{InputCNY: "2.5", OutputCNY: "8", CacheReadCNY: "0"}}
	if err := h.executeModelConnection(nil, request, func(context.Context, *model.Channel, int) error { return nil }); err != nil {
		t.Fatal(err)
	}
	var before lingtu.ModelConnection
	if err := db.First(&before).Error; err != nil {
		t.Fatal(err)
	}
	request.ConnectionID = before.ChannelID
	request.Revision = before.Revision
	request.TestAfterSave = false
	request.CostRates.InputCNY = "3"
	if err := h.saveModelConnection(nil, request); err != nil {
		t.Fatal(err)
	}
	var after lingtu.ModelConnection
	db.First(&after, before.ChannelID)
	var ch model.Channel
	db.First(&ch, before.ChannelID)
	if after.InputCNY != "3" || after.CacheReadCNY != "0" || after.Revision != before.Revision+1 || after.TestStatus != "success" || after.TestedHash != before.TestedHash || ch.Status != common.ChannelStatusEnabled {
		t.Fatal("price edit changed connection readiness", after)
	}
	if err := h.saveModelConnection(nil, request); err == nil {
		t.Fatal("stale price edit accepted")
	}
	views, err := modelConnectionViews(db, "")
	if err != nil || len(views) != 1 || views[0].InputCNY != "3" {
		t.Fatal("price readback missing", err)
	}
	request.Revision = after.Revision
	request.CostRates.InputCNY = "-1"
	if err := h.saveModelConnection(nil, request); err == nil {
		t.Fatal("negative price saved")
	}
	if err := json.Unmarshal([]byte(`{"input_cny":null,"output_cny":null,"cache_read_cny":null}`), request.CostRates); err != nil {
		t.Fatal(err)
	}
	if err := h.saveModelConnection(nil, request); err != nil {
		t.Fatal(err)
	}
	var cleared lingtu.ModelConnection
	db.First(&cleared, before.ChannelID)
	if cleared.InputCNY != "" || cleared.OutputCNY != "" || cleared.CacheReadCNY != "" {
		t.Fatal("explicit price clear lost")
	}
}

func TestLingtuCostSummaryDailyAndDetailsUseStoredSnapshot(t *testing.T) {
	db := dailyUsageTestDB(t)
	at := int64(1794585600) // 2026-11-14 00:00 Beijing, daily fixture window
	for _, r := range []lingtu.TrialRequest{{UserID: 1, RequestID: "cost", Digest: "h", State: "failed", CreatedAt: at}, {UserID: 1, RequestID: "unknown", Digest: "h", State: "uncertain", CreatedAt: at}, {UserID: 2, RequestID: "missing", Digest: "h", State: "success", CreatedAt: at}} {
		if err := db.Create(&r).Error; err != nil {
			t.Fatal(err)
		}
	}
	for _, u := range []managedUsage{{UserID: 1, RequestID: "cost", Model: "fixture", InputTokens: 100, OutputTokens: 50, UsageKnown: true, CostInputCNY: "2", CostOutputCNY: "8", CostMicros: 600, CostKnown: true, CostStatus: "estimated"}, {UserID: 1, RequestID: "unknown", CostStatus: "unknown_usage"}} {
		if err := db.Create(&u).Error; err != nil {
			t.Fatal(err)
		}
	}
	call := func(path string, summary bool) *httptest.ResponseRecorder {
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Request = httptest.NewRequest("GET", path, nil)
		if summary {
			(&Host{}).adminUsageSummary(c)
		} else {
			(&Host{}).adminUsage(c)
		}
		return w
	}
	w := call("/usage-summary", true)
	var body struct {
		Totals UsageSummaryTotals `json:"totals"`
	}
	if json.Unmarshal(w.Body.Bytes(), &body) != nil || w.Code != 200 || body.Totals.CostMicros != 600 || body.Totals.UnknownCostRequests != 2 {
		t.Fatal(w.Code, w.Body.String())
	}
	w = call("/usage-summary?user_id=1&page=2", true)
	if json.Unmarshal(w.Body.Bytes(), &body) != nil || body.Totals.CostMicros != 600 || body.Totals.UnknownCostRequests != 1 {
		t.Fatal(w.Body.String())
	}
	w = call("/usage", false)
	var detail struct {
		Items []struct {
			CostMicros int64  `json:"cost_micros"`
			CostKnown  bool   `json:"cost_known"`
			CostStatus string `json:"cost_status"`
			InputCNY   string `json:"cost_input_cny"`
		} `json:"items"`
	}
	if json.Unmarshal(w.Body.Bytes(), &detail) != nil || len(detail.Items) != 3 || detail.Items[2].CostMicros != 600 || !detail.Items[2].CostKnown || detail.Items[2].InputCNY != "2" || detail.Items[0].CostStatus != "missing_snapshot" {
		t.Fatal(w.Body.String())
	}
	_, daily := dailyUsageTestCall(t, "/usage-daily?days=7")
	if daily.Totals.CostMicros != 600 || daily.Totals.UnknownCostRequests != 2 {
		t.Fatal(daily)
	}
}

func TestLingtuJSONCostPriceOmissionPreservesAndNullClears(t *testing.T) {
	db := managedModelDB(t)
	h := &Host{}
	raw := `{"section":"model_connection","action":"save","provider":"vllm","name":"old form","base_url":"http://127.0.0.1:12345","upstream_model":"fixture","enabled":false,"cost_rates":{"input_cny":"2","output_cny":"8","cache_read_cny":"0"}}`
	if err := h.saveModelConnection(nil, connectionRequest(t, raw)); err != nil {
		t.Fatal(err)
	}
	var before lingtu.ModelConnection
	db.First(&before)
	fields := map[string]any{"section": "model_connection", "action": "save", "provider": "vllm", "connection_id": before.ChannelID, "revision": before.Revision, "name": "old form", "base_url": "http://127.0.0.1:12345", "upstream_model": "fixture", "enabled": false}
	encoded, _ := json.Marshal(fields)
	if err := h.saveModelConnection(nil, connectionRequest(t, string(encoded))); err != nil {
		t.Fatal(err)
	}
	var kept lingtu.ModelConnection
	db.First(&kept, before.ChannelID)
	if kept.InputCNY != "2" || kept.Revision != before.Revision {
		t.Fatal("old form erased prices", kept)
	}
	fields["cost_rates"] = map[string]any{"input_cny": nil}
	encoded, _ = json.Marshal(fields)
	if err := h.saveModelConnection(nil, connectionRequest(t, string(encoded))); err != nil {
		t.Fatal(err)
	}
	var cleared lingtu.ModelConnection
	db.First(&cleared, before.ChannelID)
	if cleared.InputCNY != "" || cleared.OutputCNY != "8" {
		t.Fatal("null did not clear just its price", cleared)
	}
}
func TestLingtuStoredCostsAreNeverRepricedAndRoundPerRequest(t *testing.T) {
	record := usageDailyRecord{CostSnapshot: true, CostInputCNY: "100", CostOutputCNY: "100", UsageKnown: true, InputTokens: 999, OutputTokens: 999, CostMicros: 1, CostKnown: true, CostStatus: "estimated"}
	got := estimateCNY(record, nil)
	if got.CostMicros != 1 || got.CNY != "0.000001" {
		t.Fatalf("repriced stored amount: %+v", got)
	}
	var total CostTotals
	for i := 0; i < 3; i++ {
		addCost(&total, estimateCNY(usageDailyRecord{CostSnapshot: true, CostInputCNY: "0.5", CostOutputCNY: "0", UsageKnown: true, InputTokens: 1}, nil))
	}
	if total.CostMicros != 3 || total.EstimatedCNY != "0.000003" {
		t.Fatalf("rounded after summing: %+v", total)
	}
	record.CostStatus = "unknown_usage"
	record.CostKnown = false
	if got := estimateCNY(record, nil); got.CostKnown || got.CostStatus != "unknown_usage" {
		t.Fatalf("overwrote persisted unknown: %+v", got)
	}
}

func TestLingtuAggregateCostOverflowDoesNotWrap(t *testing.T) {
	total := CostTotals{CostMicros: 9223372036854775807, EstimatedCNY: "9223372036854.775807"}
	addCost(&total, costEstimate{CostMicros: 1, CostKnown: true})
	if total.CostMicros < 0 || total.UnknownCostRequests != 1 {
		t.Fatalf("overflowed: %+v", total)
	}
}
func TestLingtuChangedModelNeverInheritsOmittedPrices(t *testing.T) {
	for _, test := range []struct {
		name           string
		rates          map[string]any
		in, out, cache string
		delayed        bool
	}{
		{name: "empty", rates: map[string]any{}},
		{name: "cache-only", rates: map[string]any{"cache_read_cny": "0.1"}, cache: "0.1"},
		{name: "input-only", rates: map[string]any{"input_cny": "3"}, in: "3"},
		{name: "output-only", rates: map[string]any{"output_cny": "9"}, out: "9"},
		{name: "delayed-empty", rates: map[string]any{}, delayed: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			db := managedModelDB(t)
			h := &Host{}
			request := connectionRequest(t, `{"section":"model_connection","action":"save","provider":"vllm","name":"fixture","base_url":"http://127.0.0.1:12345","upstream_model":"model-A","enabled":false,"cost_rates":{"input_cny":"2","output_cny":"8","cache_read_cny":"0.5"}}`)
			if err := h.saveModelConnection(nil, request); err != nil {
				t.Fatal(err)
			}
			var row lingtu.ModelConnection
			db.First(&row)
			request.ConnectionID, request.Revision, request.UpstreamModel = row.ChannelID, row.Revision, "model-B"
			if test.delayed {
				request.CostRates = nil
				if err := h.saveModelConnection(nil, request); err != nil {
					t.Fatal(err)
				}
				db.First(&row)
				request.Revision = row.Revision
				if row.CostRateModel != "model-A" {
					t.Fatalf("omission rebound old prices: %+v", row)
				}
			}
			raw, _ := json.Marshal(test.rates)
			request.CostRates = &costRatesRequest{}
			if err := json.Unmarshal(raw, request.CostRates); err != nil {
				t.Fatal(err)
			}
			if err := h.saveModelConnection(nil, request); err != nil {
				t.Fatal(err)
			}
			db.First(&row)
			if row.CostRateModel != "model-B" || row.InputCNY != test.in || row.OutputCNY != test.out || row.CacheReadCNY != test.cache {
				t.Fatalf("inherited prices from other model: %+v", row)
			}
		})
	}
}
