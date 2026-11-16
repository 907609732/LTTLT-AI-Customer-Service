package lingtu

import "testing"

func costPrice(s string) *string { return &s }
func TestLingtuCostPriceValidation(t *testing.T) {
	for _, s := range []string{"0", "1.234567", "1000000", "1000000.000000"} {
		if _, ok := ParseCostPrice(costPrice(s)); !ok {
			t.Fatal(s)
		}
	}
	for _, s := range []string{"", "-1", "1e3", "1.1234567", "1000000.000001", " 1", ".2", "NaN"} {
		if _, ok := ParseCostPrice(costPrice(s)); ok {
			t.Fatal(s)
		}
	}
	if _, ok := ParseCostPrice(nil); ok {
		t.Fatal("nil price known")
	}
}
func TestLingtuCostEstimatePrecisionAndUnknown(t *testing.T) {
	for _, tc := range []struct {
		input, output, cached int
		usage, cache          bool
		in, out, hit          *string
		want                  int64
		status                string
	}{
		{100, 50, 0, true, false, costPrice("2"), costPrice("8"), nil, 600, "estimated"},
		{1, 0, 0, true, false, costPrice("0.5"), costPrice("0"), nil, 1, "estimated"},
		{0, 0, 0, true, false, costPrice("0"), costPrice("0"), nil, 0, "estimated"},
		{100, 50, 60, true, true, costPrice("2"), costPrice("8"), costPrice("0.5"), 510, "estimated"},
		{100, 50, 0, true, false, costPrice("2"), costPrice("8"), costPrice("0.5"), 0, "cache_usage_unknown"},
		{100, 50, 0, true, false, nil, costPrice("8"), nil, 0, "missing_price"},
		{100, 50, 0, false, false, costPrice("2"), costPrice("8"), nil, 0, "unknown_usage"},
		{1000000000, 1000000000, 0, true, false, costPrice("1000000"), costPrice("1000000"), nil, 2000000000000000, "estimated"},
	} {
		got, status := EstimateTokenCost(tc.input, tc.output, tc.cached, tc.usage, tc.cache, tc.in, tc.out, tc.hit)
		if got != tc.want || status != tc.status {
			t.Fatalf("got %d/%s want %d/%s", got, status, tc.want, tc.status)
		}
	}
}
func TestLingtuDetailedTokenUsageCache(t *testing.T) {
	for _, tc := range []struct {
		raw          string
		known, cache bool
		cached       int
	}{
		{`{"usage":{"prompt_tokens":10,"completion_tokens":3,"prompt_tokens_details":{"cached_tokens":4}}}`, true, true, 4},
		{`{"usage":{"prompt_tokens":10,"completion_tokens":3,"prompt_cache_hit_tokens":0}}`, true, true, 0},
		{`{"usage":{"prompt_tokens":10,"completion_tokens":3}}`, true, false, 0},
		{`{"usage":{"prompt_tokens":10,"completion_tokens":3,"prompt_cache_hit_tokens":11}}`, true, false, 0},
		{`{"usage":{"prompt_tokens":10,"completion_tokens":3,"prompt_cache_hit_tokens":2,"prompt_tokens_details":{"cached_tokens":4}}}`, true, false, 0},
	} {
		got := ParseDetailedTokenUsage([]byte(tc.raw))
		if got.Known != tc.known || got.CacheKnown != tc.cache || got.CacheRead != tc.cached {
			t.Fatal(tc.raw, got)
		}
	}
}
