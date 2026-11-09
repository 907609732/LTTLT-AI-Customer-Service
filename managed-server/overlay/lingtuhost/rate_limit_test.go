package lingtuhost

import (
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/gin-gonic/gin"
)

func TestLingtuClientTrafficCannotExhaustBrowserLogin(t *testing.T) {
	hostDB(t)
	t.Setenv("LINGTU_API_ORIGIN", "https://api.test")
	t.Setenv("LINGTU_PORTAL_ORIGIN", "https://portal.test")
	oldSecure, oldCritical, oldGlobal := common.SessionCookieSecure, common.CriticalRateLimitEnable, common.GlobalApiRateLimitEnable
	oldCount, oldDuration := common.CriticalRateLimitNum, common.CriticalRateLimitDuration
	oldGlobalCount, oldGlobalDuration := common.GlobalApiRateLimitNum, common.GlobalApiRateLimitDuration
	common.SessionCookieSecure, common.CriticalRateLimitEnable, common.GlobalApiRateLimitEnable = true, true, true
	common.CriticalRateLimitNum, common.CriticalRateLimitDuration = 20, 1200
	common.GlobalApiRateLimitNum, common.GlobalApiRateLimitDuration = 360, 180
	t.Cleanup(func() {
		Shutdown()
		common.SessionCookieSecure, common.CriticalRateLimitEnable, common.GlobalApiRateLimitEnable = oldSecure, oldCritical, oldGlobal
		common.CriticalRateLimitNum, common.CriticalRateLimitDuration = oldCount, oldDuration
		common.GlobalApiRateLimitNum, common.GlobalApiRateLimitDuration = oldGlobalCount, oldGlobalDuration
	})
	router := gin.New()
	if err := Register(router); err != nil {
		t.Fatal(err)
	}
	router.POST("/native-login-probe", middleware.CriticalRateLimit(), func(c *gin.Context) { c.Status(204) })
	call := func(method, path, ip string) *httptest.ResponseRecorder {
		request := httptest.NewRequest(method, path, strings.NewReader("{}"))
		request.RemoteAddr = ip + ":5000"
		request.Header.Set("Content-Type", "application/json")
		response := httptest.NewRecorder()
		router.ServeHTTP(response, request)
		return response
	}
	ip := "192.0.2.193"
	for i := 0; i < 45; i++ {
		if r := call("GET", "/api/client/me", ip); r.Code != 401 {
			t.Fatalf("status request %d consumed login quota: %d", i+1, r.Code)
		}
	}
	for _, test := range []struct {
		path          string
		count, status int
	}{{"/api/client/auth/device/token", 120, 400}, {"/api/client/auth/refresh", 120, 401}} {
		for i := 0; i < test.count; i++ {
			if r := call("POST", test.path, ip); r.Code != test.status {
				t.Fatalf("%s request %d: got %d", test.path, i+1, r.Code)
			}
		}
		if r := call("POST", test.path, ip); r.Code != 429 || r.Header().Get("Retry-After") != "60" {
			t.Fatalf("auth route no longer bounded: %s %d", test.path, r.Code)
		}
	}
	for i := 0; i < 20; i++ {
		if r := call("POST", "/native-login-probe", ip); r.Code != 204 {
			t.Fatalf("client traffic blocked browser login %d: %d", i+1, r.Code)
		}
	}
	if r := call("POST", "/native-login-probe", ip); r.Code != 429 || r.Header().Get("Retry-After") != "1200" || !strings.Contains(r.Body.String(), "message_key") {
		t.Fatalf("browser login protection or translated rejection missing: %d", r.Code)
	}
	otherIP := "192.0.2.194"
	for i := 0; i < 20; i++ {
		call("POST", "/native-login-probe", otherIP)
	}
	if r := call("GET", "/api/client/me", otherIP); r.Code != 401 {
		t.Fatalf("browser quota blocked desktop: %d", r.Code)
	}
	for i := 0; i < 10; i++ {
		if r := call("POST", "/api/client/auth/device/authorize", otherIP); r.Code != 200 {
			t.Fatalf("device authorize %d: %d", i+1, r.Code)
		}
	}
	if r := call("POST", "/api/client/auth/device/authorize", otherIP); r.Code != 429 {
		t.Fatalf("device authorization unbounded: %d", r.Code)
	}
}
