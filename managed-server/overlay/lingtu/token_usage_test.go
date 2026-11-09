package lingtu

import "testing"

func TestLingtuParseTokenUsagePreservesKnownZeroAndUnknown(t *testing.T) {
	for _, raw := range []string{`{}`, `{"usage":null}`, `{"usage":{}}`, `{"usage":{"prompt_tokens":1}}`, `{"usage":{"prompt_tokens":null,"completion_tokens":0}}`, `{"usage":{"prompt_tokens":1.5,"completion_tokens":0}}`, `{"usage":{"prompt_tokens":-1,"completion_tokens":0}}`, `{"usage":{"prompt_tokens":1000000001,"completion_tokens":0}}`} {
		if _, _, known := ParseTokenUsage([]byte(raw)); known {
			t.Fatal(raw)
		}
	}
	for _, raw := range []string{`{"usage":{"prompt_tokens":0,"completion_tokens":0}}`, `{"usage":{"prompt_tokens":2,"completion_tokens":3,"private":"ignored"}}`} {
		if _, _, known := ParseTokenUsage([]byte(raw)); !known {
			t.Fatal(raw)
		}
	}
}
