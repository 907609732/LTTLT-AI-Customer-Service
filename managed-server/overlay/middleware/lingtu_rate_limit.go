package middleware

import (
	"github.com/QuantumNous/new-api/common"
	"github.com/gin-gonic/gin"
)

// Keep desktop traffic out of the native browser-login bucket. Reuse the
// upstream memory/Redis implementation and Retry-After response behavior.
func LingtuIPRateLimit(scope string, count int, seconds int64) gin.HandlerFunc {
	return rateLimitFactory(count, seconds, "LT:"+scope+":")
}

func LingtuCriticalRateLimit(scope string) gin.HandlerFunc {
	if common.CriticalRateLimitEnable {
		return LingtuIPRateLimit(scope, common.CriticalRateLimitNum, common.CriticalRateLimitDuration)
	}
	return func(c *gin.Context) { c.Next() }
}
