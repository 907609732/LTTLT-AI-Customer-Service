package lingtuhost

import (
	"errors"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/gin-gonic/gin"
)

// HTTP is an explicit single-machine development mode, never a production fallback.
func validateManagedOrigins(apiOrigin, portal string) error {
	if os.Getenv("LINGTU_LOCAL_HTTP") == "1" {
		u, err := url.Parse(apiOrigin)
		if err != nil || u.Scheme != "http" || u.Hostname() != "127.0.0.1" || u.Port() == "" || apiOrigin != portal || os.Getenv("LINGTU_LISTEN_HOST") != "127.0.0.1" || common.SessionCookieSecure {
			return errors.New("local HTTP requires identical 127.0.0.1 origins, loopback binding and non-secure development cookies")
		}
		return nil
	}
	if !strings.HasPrefix(apiOrigin, "https://") || !strings.HasPrefix(portal, "https://") || !common.SessionCookieSecure {
		return errors.New("managed service requires HTTPS origins and secure session cookies")
	}
	return nil
}

// Validate the real peer and Host; reject cross-origin browser writes even without secure cookies.
func localHTTPGuard(origin string) gin.HandlerFunc {
	u, _ := url.Parse(origin)
	return func(c *gin.Context) {
		peer, _, err := net.SplitHostPort(c.Request.RemoteAddr)
		valid := err == nil && peer == "127.0.0.1" && c.Request.Host == u.Host
		if values := c.Request.Header.Values("Origin"); len(values) > 0 {
			valid = valid && len(values) == 1 && values[0] == origin
		} else if c.Request.Method != http.MethodGet && c.Request.Method != http.MethodHead && c.Request.Method != http.MethodOptions {
			// Browser forms may omit Origin; their Referer must still be local. Native clients have neither.
			if referer := c.GetHeader("Referer"); referer != "" {
				r, e := url.Parse(referer)
				valid = valid && e == nil && r.Scheme+"://"+r.Host == origin
			}
		}
		if !valid {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"success": false, "message": "local HTTP request rejected"})
			return
		}
		c.Next()
	}
}
