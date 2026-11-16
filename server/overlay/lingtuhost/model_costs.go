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
}
type CostTotals struct {
	EstimatedCNY        string `json:"estimated_cny" gorm:"-"`
	CostedRequests      int64  `json:"costed_requests" gorm:"-"`
	UnpricedRequests    int64  `json:"unpriced_requests" gorm:"-"`
	CurrentRateRequests int64  `json:"current_rate_requests" gorm:"-"`
	CostMicros          int64  `json:"cost_micros" gorm:"-"`
	UnknownCostRequests int64  `json:"unknown_cost_requests" gorm:"-"`
}

// Historical rows are priced only from their own admission snapshot. Once a
// status is persisted, every view uses the same per-request rounded integer.
func estimateCNY(record usageDailyRecord, _ map[int]lingtu.ModelConnection) costEstimate {
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
		cost.CNY = decimal.NewFromInt(micros).Shift(-6).String()
	}
	return cost
}
func addCost(total *CostTotals, cost costEstimate) {
	// An unrepresentable subtotal is left out and explicitly counted as unknown,
	// rather than wrapping the integer amount into a negative cost.
	if !cost.CostKnown || cost.CostMicros < 0 || total.CostMicros > 9223372036854775807-cost.CostMicros {
		total.UnpricedRequests++
		total.UnknownCostRequests++
		return
	}
	total.CostMicros += cost.CostMicros
	total.EstimatedCNY = decimal.NewFromInt(total.CostMicros).Shift(-6).String()
	total.CostedRequests++
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
