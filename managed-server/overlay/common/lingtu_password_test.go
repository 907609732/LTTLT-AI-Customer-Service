package common

import (
	"strings"
	"testing"
)

func TestLingtuPublicPasswordMinimumForAccountsWithoutMFA(t *testing.T) {
	for _, length := range []int{8, 14} {
		if ValidateNewAccountPassword(strings.Repeat("x", length)) == nil {
			t.Fatalf("accepted %d character single-factor password", length)
		}
	}
	if err := ValidateNewAccountPassword(strings.Repeat("x", 15)); err != nil {
		t.Fatal(err)
	}
	if err := ValidateNewAccountPassword(strings.Repeat("字", 15)); err != nil {
		t.Fatal(err)
	}
}
