package lingtuhost

import (
	"context"
	"encoding/json"
	"github.com/QuantumNous/new-api/lingtu"
	"github.com/QuantumNous/new-api/model"
	"github.com/shopspring/decimal"
)

type costRatesRequest struct {
	InputCNY     string `json:"input_cny"`
	OutputCNY    string `json:"output_cny"`
	CacheReadCNY string `json:"cache_read_cny"`
	supplied     map[string]bool
}

func (r *costRatesRequest) UnmarshalJSON(raw []byte) error {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(raw, &fields); err != nil {
		return err
	}
	for key := range fields {
		if key != "input_cny" && key != "output_cny" && key != "cache_read_cny" {
			return lingtu.ErrInvalidTrialInput
		}
	}
	r.supplied = map[string]bool{}
	for key, target := range map[string]*string{"input_cny": &r.InputCNY, "output_cny": &r.OutputCNY, "cache_read_cny": &r.CacheReadCNY} {
		if value, ok := fields[key]; ok {
			r.supplied[key] = true
			*target = ""
			if string(value) != "null" {
				if err := json.Unmarshal(value, target); err != nil {
					return err
				}
			}
		}
	}
	return nil
}
func (r *costRatesRequest) present(key string) bool {
	if r.supplied != nil {
		return r.supplied[key]
	}
	switch key {
	case "input_cny":
		return r.InputCNY != ""
	case "output_cny":
		return r.OutputCNY != ""
	default:
		return r.CacheReadCNY != ""
	}
}
func optionalCostPrice(raw string) *string {
	if raw == "" {
		return nil
	}
	return &raw
}
func normalizeCostRate(raw string) (string, error) {
	if raw == "" {
		return "", nil
	}
	if _, ok := lingtu.ParseCostPrice(&raw); !ok {
		return "", lingtu.ErrInvalidTrialInput
	}
	value, _ := decimal.NewFromString(raw)
	return value.String(), nil
}

type costEstimate struct {
	CNY              string `json:"estimated_cny" gorm:"-"`
	Basis            string `json:"cost_basis" gorm:"-"`
	CostMicros       int64  `json:"cost_micros" gorm:"-"`
	CostKnown        bool   `json:"cost_known" gorm:"-"`
	CostStatus       string `json:"cost_status" gorm:"-"`
	CostInputCNY     string `json:"cost_input_cny" gorm:"-"`
	CostOutputCNY    string `json:"cost_output_cny" gorm:"-"`
	CostCacheReadCNY string `json:"cost_cache_read_cny" gorm:"-"`
	CacheReadTokens  int    `json:"cache_read_tokens" gorm:"-"`
	CacheUsageKnown  bool   `json:"cache_usage_known" gorm:"-"`

	// The fields below are a read-only historical recalculation at today's saved
	// rates. They never replace the admission snapshot or its persisted status.
	HistoricalEstimatedCNY   string `json:"historical_estimated_cny" gorm:"-"`
	HistoricalCostMicros     int64  `json:"historical_cost_micros" gorm:"-"`
	HistoricalCostKnown      bool   `json:"historical_cost_known" gorm:"-"`
	HistoricalBasis          string `json:"historical_cost_basis" gorm:"-"`
	HistoricalInputPriceOnly bool   `json:"historical_input_price_only" gorm:"-"`
	ReportEstimatedCNY       string `json:"report_estimated_cny" gorm:"-"`
	ReportCostMicros         int64  `json:"report_cost_micros" gorm:"-"`
	ReportCostKnown          bool   `json:"report_cost_known" gorm:"-"`

	historicalApplicable bool
}
type CostTotals struct {
	EstimatedCNY        string `json:"estimated_cny" gorm:"-"`
	CostedRequests      int64  `json:"costed_requests" gorm:"-"`
	UnpricedRequests    int64  `json:"unpriced_requests" gorm:"-"`
	CurrentRateRequests int64  `json:"current_rate_requests" gorm:"-"`
	CostMicros          int64  `json:"cost_micros" gorm:"-"`
	UnknownCostRequests int64  `json:"unknown_cost_requests" gorm:"-"`

	HistoricalEstimatedCNY     string `json:"historical_estimated_cny" gorm:"-"`
	HistoricalCostMicros       int64  `json:"historical_cost_micros" gorm:"-"`
	HistoricalCostedRequests   int64  `json:"historical_costed_requests" gorm:"-"`
	HistoricalUnpricedRequests int64  `json:"historical_unpriced_requests" gorm:"-"`
	UncachedInputEstimates     int64  `json:"uncached_input_estimates" gorm:"-"`
	ReportEstimatedCNY         string `json:"report_estimated_cny" gorm:"-"`
	ReportCostMicros           int64  `json:"report_cost_micros" gorm:"-"`
	ReportCostedRequests       int64  `json:"report_costed_requests" gorm:"-"`
	ReportUnpricedRequests     int64  `json:"report_unpriced_requests" gorm:"-"`
}

func microsCNY(micros int64) string {
	return decimal.NewFromInt(micros).Shift(-6).String()
}

// Only a row without complete admission prices is eligible for a read-only historical
// estimate. Exact channel and recorded upstream model must both match the saved
// rate row; no model-name guessing and no write-back are allowed.
func historicalCurrentRateEstimate(record usageDailyRecord, rates map[int]lingtu.ModelConnection) (int64, bool, string, bool) {
	if record.ChannelID <= 0 || record.UpstreamModel == "" {
		return 0, false, "unpriced", false
	}
	rate, ok := rates[record.ChannelID]
	if !ok || rate.CostRateModel != record.UpstreamModel || rate.InputCNY == "" || rate.OutputCNY == "" {
		return 0, false, "unpriced", false
	}
	if int64(int(record.InputTokens)) != record.InputTokens || int64(int(record.OutputTokens)) != record.OutputTokens {
		return 0, false, "unpriced", false
	}
	inputOnly := !record.CacheUsageKnown
	var cachePrice *string
	if record.CacheUsageKnown {
		cachePrice = optionalCostPrice(rate.CacheReadCNY)
	}
	// Omitting the cache price makes EstimateTokenCost price every input token at
	// the normal input rate; the cache-known flag itself is never modified.
	micros, status := lingtu.EstimateTokenCost(int(record.InputTokens), int(record.OutputTokens), record.CacheReadTokens, record.UsageKnown, record.CacheUsageKnown, optionalCostPrice(rate.InputCNY), optionalCostPrice(rate.OutputCNY), cachePrice)
	if status != "estimated" || micros < 0 {
		return 0, false, "unpriced", inputOnly
	}
	if inputOnly {
		return micros, true, "current_rates_uncached_input", true
	}
	return micros, true, "current_rates", false
}

// Historical rows are priced only from their own admission snapshot. Once a
// status is persisted, every view uses the same per-request rounded integer.
// A separate current-rate estimate is added without changing that evidence.
func estimateCNY(record usageDailyRecord, rates map[int]lingtu.ModelConnection) costEstimate {
	cost := costEstimate{Basis: "unpriced", CostStatus: record.CostStatus, CostInputCNY: record.CostInputCNY, CostOutputCNY: record.CostOutputCNY, CostCacheReadCNY: record.CostCacheReadCNY, CacheReadTokens: record.CacheReadTokens, CacheUsageKnown: record.CacheUsageKnown}
	micros, status := record.CostMicros, record.CostStatus
	if status == "" {
		if !record.CostSnapshot {
			status = "missing_snapshot"
		} else {
			micros, status = lingtu.EstimateTokenCost(int(record.InputTokens), int(record.OutputTokens), record.CacheReadTokens, record.UsageKnown, record.CacheUsageKnown, optionalCostPrice(record.CostInputCNY), optionalCostPrice(record.CostOutputCNY), optionalCostPrice(record.CostCacheReadCNY))
		}
	}
	cost.CostStatus = status
	if status == "estimated" && (record.CostStatus == "" || record.CostKnown) && micros >= 0 {
		cost.CostMicros, cost.CostKnown, cost.Basis = micros, true, "snapshot"
		cost.CNY = microsCNY(micros)
	}
	if !cost.CostKnown && record.CostStatus == "" && (!record.CostSnapshot || record.CostInputCNY == "" || record.CostOutputCNY == "") {
		cost.historicalApplicable = true
		historicalMicros, historicalKnown, basis, inputOnly := historicalCurrentRateEstimate(record, rates)
		cost.HistoricalBasis = basis
		if historicalKnown {
			cost.HistoricalCostKnown, cost.HistoricalCostMicros = true, historicalMicros
			cost.HistoricalEstimatedCNY = microsCNY(historicalMicros)
			cost.HistoricalInputPriceOnly = inputOnly
		}
	}
	if cost.CostKnown {
		cost.ReportCostKnown, cost.ReportCostMicros = true, cost.CostMicros
		cost.ReportEstimatedCNY = cost.CNY
	} else if cost.HistoricalCostKnown {
		cost.ReportCostKnown, cost.ReportCostMicros = true, cost.HistoricalCostMicros
		cost.ReportEstimatedCNY = cost.HistoricalEstimatedCNY
	}
	return cost
}

const maxCostMicros = int64(^uint64(0) >> 1)

func addMicros(total *int64, amount int64) bool {
	if amount < 0 || *total < 0 || *total > maxCostMicros-amount {
		return false
	}
	*total += amount
	return true
}
func addCost(total *CostTotals, cost costEstimate) {
	// An unrepresentable subtotal is left out and explicitly counted as unknown,
	// rather than wrapping the integer amount into a negative cost.
	if !cost.CostKnown || cost.CostMicros < 0 || !addMicros(&total.CostMicros, cost.CostMicros) {
		total.UnpricedRequests++
		total.UnknownCostRequests++
		return
	}
	total.EstimatedCNY = microsCNY(total.CostMicros)
	total.CostedRequests++
}
func addHistoricalCost(total *CostTotals, cost costEstimate) {
	if !cost.historicalApplicable {
		return
	}
	if !cost.HistoricalCostKnown || cost.HistoricalCostMicros < 0 || !addMicros(&total.HistoricalCostMicros, cost.HistoricalCostMicros) {
		total.HistoricalUnpricedRequests++
		return
	}
	total.HistoricalEstimatedCNY = microsCNY(total.HistoricalCostMicros)
	total.HistoricalCostedRequests++
	if cost.HistoricalInputPriceOnly {
		total.UncachedInputEstimates++
	}
}
func addReportCost(total *CostTotals, cost costEstimate) {
	// Exactly one component per request enters the report total, so a request
	// with both a snapshot and a recalculation is never counted twice.
	amount, known := int64(0), false
	if cost.CostKnown {
		amount, known = cost.CostMicros, true
	} else if cost.HistoricalCostKnown {
		amount, known = cost.HistoricalCostMicros, true
	}
	if !known || amount < 0 || !addMicros(&total.ReportCostMicros, amount) {
		total.ReportUnpricedRequests++
		return
	}
	total.ReportEstimatedCNY = microsCNY(total.ReportCostMicros)
	total.ReportCostedRequests++
}
func loadCostRates(ctx context.Context) (map[int]lingtu.ModelConnection, error) {
	var records []lingtu.ModelConnection
	err := model.DB.WithContext(ctx).Find(&records).Error
	result := map[int]lingtu.ModelConnection{}
	for _, record := range records {
		result[record.ChannelID] = record
	}
	return result, err
}

const costUsageSelect = `COALESCE(u.cost_micros,0) AS cost_micros, COALESCE(u.cost_known,FALSE) AS cost_known, COALESCE(u.cost_status,'') AS cost_status, COALESCE(u.cost_cache_read_cny,'') AS cost_cache_read_cny, COALESCE(u.cache_read_tokens,0) AS cache_read_tokens, COALESCE(u.cache_usage_known,FALSE) AS cache_usage_known, COALESCE(u.cost_snapshot,FALSE) AS cost_snapshot, COALESCE(u.cost_input_cny,'') AS cost_input_cny, COALESCE(u.cost_output_cny,'') AS cost_output_cny`
const costRecordSelect = costUsageSelect + `, r.user_id, COALESCE(u.channel_id,0) AS channel_id, COALESCE(u.upstream_model,'') AS upstream_model, COALESCE(u.input_tokens,0) AS input_tokens, COALESCE(u.output_tokens,0) AS output_tokens, COALESCE(u.usage_known,FALSE) AS usage_known`
