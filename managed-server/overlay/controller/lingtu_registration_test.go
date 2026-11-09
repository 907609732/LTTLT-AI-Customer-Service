package controller

import (
 "encoding/json"
 "net/http/httptest"
 "strings"
 "testing"
 "github.com/QuantumNous/new-api/common"
 "github.com/gin-gonic/gin"
)

func TestLingtuRegistrationUnavailableDoesNotRequestAnUnconfiguredEmail(t *testing.T) {
 previous:=common.EmailVerificationEnabled;common.EmailVerificationEnabled=false
 t.Cleanup(func(){common.EmailVerificationEnabled=previous})
 recorder:=httptest.NewRecorder();c,_:=gin.CreateTestContext(recorder)
 c.Request=httptest.NewRequest("POST","/api/user/register",strings.NewReader(`{}`))
 c.Request.Header.Set("Content-Type","application/json")
 Register(c)
 var body struct{Success bool `json:"success"`;Message string `json:"message"`}
 if err:=json.Unmarshal(recorder.Body.Bytes(),&body);err!=nil{t.Fatal(err)}
 if body.Success||!strings.Contains(body.Message,"not configured")||!strings.Contains(body.Message,"existing account"){t.Fatalf("misleading unavailable-registration response: %s",body.Message)}
}
