package lingtu

import (
	"math/big"
	"regexp"
	"strconv"
	"strings"
)

var costPricePattern = regexp.MustCompile(`^(0|[1-9][0-9]{0,6})(\.[0-9]{1,6})?$`)

// Prices are CNY per million tokens; their integer representation is micro-CNY.
func ParseCostPrice(price *string) (int64, bool) {
	if price == nil || !costPricePattern.MatchString(*price) {
		return 0, false
	}
	parts := strings.SplitN(*price, ".", 2)
	whole, _ := strconv.ParseInt(parts[0], 10, 64)
	fraction := ""
	if len(parts) == 2 {
		fraction = parts[1]
	}
	fraction += strings.Repeat("0", 6-len(fraction))
	minor, _ := strconv.ParseInt(fraction, 10, 64)
	value := whole*1000000 + minor
	return value, value <= 1000000000000
}

// Round once per request, half up to micro-CNY, before aggregating stored costs.
func EstimateTokenCost(input, output, cached int, usageKnown, cacheKnown bool, inputPrice, outputPrice, cachePrice *string) (int64, string) {
	if !usageKnown || input < 0 || output < 0 {
		return 0, "unknown_usage"
	}
	in, okIn := ParseCostPrice(inputPrice)
	out, okOut := ParseCostPrice(outputPrice)
	if !okIn || !okOut {
		return 0, "missing_price"
	}
	hit := in
	if cachePrice != nil {
		var ok bool
		hit, ok = ParseCostPrice(cachePrice)
		if !ok {
			return 0, "missing_price"
		}
		if !cacheKnown || cached < 0 || cached > input {
			return 0, "cache_usage_unknown"
		}
	}
	if !cacheKnown || cached < 0 || cached > input {
		cached = 0
	}
	total := new(big.Int).Mul(big.NewInt(int64(input-cached)), big.NewInt(in))
	total.Add(total, new(big.Int).Mul(big.NewInt(int64(cached)), big.NewInt(hit)))
	total.Add(total, new(big.Int).Mul(big.NewInt(int64(output)), big.NewInt(out)))
	total.Add(total, big.NewInt(500000))
	total.Quo(total, big.NewInt(1000000))
	if !total.IsInt64() {
		return 0, "cost_overflow"
	}
	return total.Int64(), "estimated"
}
