package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/gin-gonic/gin"
)

func TestLingtuDashboardRejectsTrialBypassAndAllowsAccountSecurity(t *testing.T) {
	for _, test := range []struct {
		path string
		role int
		deny bool
	}{
		{"/pg/chat/completions", common.RoleCommonUser, true},
		{"/api/token/", common.RoleCommonUser, true},
		{"/api/user/access-token", common.RoleCommonUser, true},
		{"/api/user/self", common.RoleCommonUser, false},
		{"/api/token/", common.RoleAdminUser, false},
	} {
		recorder := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(recorder)
		c.Request = httptest.NewRequest("POST", test.path, nil)
		if got := denyManagedDashboardBypass(c, test.role); got != test.deny {
			t.Fatalf("%s role %d denied %v", test.path, test.role, got)
		}
		if test.deny && recorder.Code != http.StatusForbidden {
			t.Fatal(recorder.Code)
		}
	}
}
