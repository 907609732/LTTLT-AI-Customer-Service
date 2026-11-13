package lingtu

import "encoding/json"

// ParseTokenUsage accepts only an explicit, complete provider usage object.
// A missing count, null, fraction, negative or implausibly large value is unknown.
// Each count is bounded so both persistence and addition fit signed 32-bit SQL.
func ParseTokenUsage(raw []byte) (int, int, bool) {
	var response struct {
		Usage *struct {
			Input  *int64 `json:"prompt_tokens"`
			Output *int64 `json:"completion_tokens"`
		} `json:"usage"`
	}
	if json.Unmarshal(raw, &response) != nil || response.Usage == nil || response.Usage.Input == nil || response.Usage.Output == nil {
		return 0, 0, false
	}
	input, output := *response.Usage.Input, *response.Usage.Output
	if input < 0 || output < 0 || input > 1000000000 || output > 1000000000 {
		return 0, 0, false
	}
	return int(input), int(output), true
}
