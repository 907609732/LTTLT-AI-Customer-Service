package lingtuhost

import (
	"github.com/gin-gonic/gin"
	"net/http"
)

// All client routes share a conservative limit before authentication and parsing.
func limitClientBody(c *gin.Context) {
	limit := int64(1024 * 1024)
	// Knowledge image tiles have their own strict pixel/text validation in prepareChat.
	if c.Request.Method == http.MethodPost && c.Request.URL.Path == "/api/client/chat/completions" {
		limit = 16 * 1024 * 1024
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, limit)
	c.Next()
}
