package lingtuhost

import (
	"bytes"
	"github.com/gin-gonic/gin"
	"io"
	"net/http/httptest"
	"testing"
)

func TestLingtuClientBodyLimitOnlyAllowsLargeChatPOST(t *testing.T) {
	for _, tc := range []struct {
		method, path string
		want         int
	}{{"POST", "/api/client/chat/completions", 200}, {"POST", "/api/client/auth/refresh", 413}, {"GET", "/api/client/chat/completions", 413}, {"POST", "/api/client/chat/completions/other", 413}} {
		router := gin.New()
		router.Use(limitClientBody)
		router.Handle(tc.method, tc.path, func(c *gin.Context) {
			_, err := io.ReadAll(c.Request.Body)
			if err != nil {
				c.Status(413)
				return
			}
			c.Status(200)
		})
		response := httptest.NewRecorder()
		router.ServeHTTP(response, httptest.NewRequest(tc.method, tc.path, bytes.NewReader(make([]byte, 2*1024*1024))))
		if response.Code != tc.want {
			t.Fatalf("%s %s: got %d want %d", tc.method, tc.path, response.Code, tc.want)
		}
	}
}
