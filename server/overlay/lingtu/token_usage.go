package lingtu

import "encoding/json"

type DetailedTokenUsage struct {
	Input, Output, CacheRead int
	Known, CacheKnown        bool
}

// ParseTokenUsage preserves the original three-value API for existing adapters.
func ParseTokenUsage(raw []byte) (int, int, bool) {
	u := ParseDetailedTokenUsage(raw)
	return u.Input, u.Output, u.Known
}

// Cache counters are a subset of total prompt tokens, never additional input.
func ParseDetailedTokenUsage(raw []byte) DetailedTokenUsage {
	var response struct {
		Usage *struct {
			Input   *int64          `json:"prompt_tokens"`
			Output  *int64          `json:"completion_tokens"`
			Cache   json.RawMessage `json:"prompt_cache_hit_tokens"`
			Details *struct {
				Cache json.RawMessage `json:"cached_tokens"`
			} `json:"prompt_tokens_details"`
		} `json:"usage"`
	}
	if json.Unmarshal(raw, &response) != nil || response.Usage == nil || response.Usage.Input == nil || response.Usage.Output == nil {
		return DetailedTokenUsage{}
	}
	r := response.Usage
	input, output := *r.Input, *r.Output
	if input < 0 || output < 0 || input > 1000000000 || output > 1000000000 {
		return DetailedTokenUsage{}
	}
	u := DetailedTokenUsage{Input: int(input), Output: int(output), Known: true}
	var cache *int64
	values := []json.RawMessage{r.Cache}
	if r.Details != nil {
		values = append(values, r.Details.Cache)
	}
	for _, raw := range values {
		if len(raw) == 0 {
			continue
		}
		var value *int64
		if json.Unmarshal(raw, &value) != nil || value == nil || *value < 0 || *value > input || cache != nil && *cache != *value {
			return u
		}
		cache = value
	}
	if cache != nil {
		u.CacheRead = int(*cache)
		u.CacheKnown = true
	}
	return u
}
