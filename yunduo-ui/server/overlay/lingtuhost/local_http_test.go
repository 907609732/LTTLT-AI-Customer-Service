package lingtuhost

import (
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/gin-gonic/gin"
)

func TestLocalHTTPBoundaries(t *testing.T) {
	old := common.SessionCookieSecure
	t.Cleanup(func() { common.SessionCookieSecure = old })
	common.SessionCookieSecure = false
	t.Setenv("LINGTU_LOCAL_HTTP", "1")
	t.Setenv("LINGTU_LISTEN_HOST", "127.0.0.1")
	origin := "http://127.0.0.1:3000"
	if err := validateManagedOrigins(origin, origin); err != nil {
		t.Fatal(err)
	}
	for _, other := range []string{"http://example.com:3000", "http://127.0.0.1.evil:3000", "http://localhost:3000"} {
		if validateManagedOrigins(other, other) == nil {
			t.Fatalf("accepted %s", other)
		}
	}
	t.Setenv("LINGTU_LISTEN_HOST", "0.0.0.0")
	if validateManagedOrigins(origin, origin) == nil {
		t.Fatal("accepted public bind")
	}
	t.Setenv("LINGTU_LISTEN_HOST", "127.0.0.1")
	t.Setenv("LINGTU_LOCAL_HTTP", "")
	if validateManagedOrigins(origin, origin) == nil {
		t.Fatal("accepted implicit HTTP")
	}
	router := gin.New()
	router.Use(localHTTPGuard(origin))
	router.POST("/probe", func(c *gin.Context) { c.Status(204) })
	for _, tc := range []struct {
		host, peer, browserOrigin string
		want                      int
	}{
		{"127.0.0.1:3000", "127.0.0.1:55000", origin, 204},
		{"127.0.0.1:3000", "127.0.0.1:55000", "", 204},
		{"evil.test", "127.0.0.1:55000", "", 403},
		{"127.0.0.1:3000", "192.0.2.1:55000", origin, 403},
		{"127.0.0.1:3000", "127.0.0.1:55000", "http://evil.test", 403},
	} {
		r := httptest.NewRequest("POST", origin+"/probe", nil)
		r.Host, r.RemoteAddr = tc.host, tc.peer
		if tc.browserOrigin != "" {
			r.Header.Set("Origin", tc.browserOrigin)
		}
		w := httptest.NewRecorder()
		router.ServeHTTP(w, r)
		if w.Code != tc.want {
			t.Fatalf("%+v: got %d", tc, w.Code)
		}
	}
}
