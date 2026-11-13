package middleware

import (
 "net/http/httptest"
 "strings"
 "testing"
 "github.com/QuantumNous/new-api/common"
 "github.com/gin-gonic/gin"
)

func TestLingtuCORSAllowsSessionRefreshHeaderOnlyForTrustedOrigins(t *testing.T) {
 original:=common.SessionCookieTrustedURLs
 common.SessionCookieTrustedURLs=[]string{"https://account-kefu.lttlt.top"}
 t.Cleanup(func(){common.SessionCookieTrustedURLs=original})
 router:=gin.New();router.Use(CORS());router.POST("/api/user/auth/refresh",func(c *gin.Context){c.Status(200)})
 request:=httptest.NewRequest("OPTIONS","/api/user/auth/refresh",nil)
 request.Header.Set("Origin","https://account-kefu.lttlt.top")
 request.Header.Set("Access-Control-Request-Method","POST")
 request.Header.Set("Access-Control-Request-Headers","cache-control,x-auth-session")
 recorder:=httptest.NewRecorder();router.ServeHTTP(recorder,request)
 if recorder.Code!=204 || recorder.Header().Get("Access-Control-Allow-Origin")!="https://account-kefu.lttlt.top" || recorder.Header().Get("Access-Control-Allow-Credentials")!="true" {t.Fatalf("preflight failed: %d",recorder.Code)}
 if !strings.Contains(strings.ToLower(recorder.Header().Get("Access-Control-Allow-Headers")),"x-auth-session") {t.Fatal("browser refresh session header is not allowed")}
 request.Header.Set("Origin","https://untrusted.example")
 denied:=httptest.NewRecorder();router.ServeHTTP(denied,request)
 if denied.Code!=403 || denied.Header().Get("Access-Control-Allow-Origin")!="" {t.Fatal("untrusted origin was allowed")}
}
