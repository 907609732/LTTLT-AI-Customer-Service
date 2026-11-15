package lingtuhost

import (
	"context"
	"github.com/QuantumNous/new-api/lingtu"
	"github.com/QuantumNous/new-api/model"
	"github.com/shopspring/decimal"
	"regexp"
)

type costRatesRequest struct {
	InputCNY  string `json:"input_cny"`
	OutputCNY string `json:"output_cny"`
}

var costRatePattern = regexp.MustCompile(`^(0|[1-9][0-9]{0,5})(\.[0-9]{1,6})?$`)

func normalizeCostRate(raw string) (string, error) {
	if raw == "" {
		return "", nil
	}
	if !costRatePattern.MatchString(raw) {
		return "", lingtu.ErrInvalidTrialInput
	}
	value, err := decimal.NewFromString(raw)
	if err != nil {
		return "", lingtu.ErrInvalidTrialInput
	}
	return value.String(), nil
}

type costEstimate struct {
	CNY   string `json:"estimated_cny" gorm:"-"`
	Basis string `json:"cost_basis" gorm:"-"`
}
type CostTotals struct {
	EstimatedCNY        string `json:"estimated_cny" gorm:"-"`
	CostedRequests      int64  `json:"costed_requests" gorm:"-"`
	UnpricedRequests    int64  `json:"unpriced_requests" gorm:"-"`
	CurrentRateRequests int64  `json:"current_rate_requests" gorm:"-"`
}

// Decimal strings retain micro-costs without changing the native wallet/call
// ledgers. These are configured-rate estimates, never a supplier invoice.
func estimateCNY(record usageDailyRecord, rates map[int]lingtu.ModelConnection) costEstimate {
	unknown := costEstimate{Basis: "unpriced"}
	if !record.UsageKnown || record.InputTokens < 0 || record.OutputTokens < 0 {
		return unknown
	}
	input, output, basis := record.CostInputCNY, record.CostOutputCNY, "snapshot"
	if !record.CostSnapshot {
		rate, ok := rates[record.ChannelID]
		if !ok || record.UpstreamModel == "" || rate.CostRateModel != record.UpstreamModel {
			return unknown
		}
		input, output, basis = rate.InputCNY, rate.OutputCNY, "current_rates"
	}
	if input == "" || output == "" {
		return unknown
	}
	i, err := normalizeCostRate(input)
	if err != nil {
		return unknown
	}
	o, err := normalizeCostRate(output)
	if err != nil {
		return unknown
	}
	in, _ := decimal.NewFromString(i)
	out, _ := decimal.NewFromString(o)
	cost := in.Mul(decimal.NewFromInt(record.InputTokens)).Add(out.Mul(decimal.NewFromInt(record.OutputTokens))).Shift(-6)
	return costEstimate{CNY: cost.String(), Basis: basis}
}
func addCost(total *CostTotals, cost costEstimate) {
	if cost.Basis == "unpriced" {
		total.UnpricedRequests++
		return
	}
	current, _ := decimal.NewFromString(total.EstimatedCNY)
	next, _ := decimal.NewFromString(cost.CNY)
	total.EstimatedCNY = current.Add(next).String()
	total.CostedRequests++
	if cost.Basis == "current_rates" {
		total.CurrentRateRequests++
	}
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

const costUsageSelect = `COALESCE(u.cost_snapshot,FALSE) AS cost_snapshot, COALESCE(u.cost_input_cny,'') AS cost_input_cny, COALESCE(u.cost_output_cny,'') AS cost_output_cny`
const costRecordSelect = costUsageSelect + `, r.user_id, COALESCE(u.channel_id,0) AS channel_id, COALESCE(u.upstream_model,'') AS upstream_model, COALESCE(u.input_tokens,0) AS input_tokens, COALESCE(u.output_tokens,0) AS output_tokens, COALESCE(u.usage_known,FALSE) AS usage_known`
