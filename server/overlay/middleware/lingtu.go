package middleware

import (
	"net/http"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/gin-gonic/gin"
)

func denyManagedDashboardBypass(c *gin.Context, role int) bool {
	if role >= common.RoleAdminUser {
		return false
	}
	path := c.Request.URL.Path
	if strings.HasPrefix(path, "/api/token") || strings.HasPrefix(path, "/api/user/access-token") || strings.HasPrefix(path, "/pg/") {
		c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"success": false, "code": "MANAGED_CLIENT_REQUIRED", "message": "Managed accounts must use the client endpoint"})
		return true
	}
	return false
}
