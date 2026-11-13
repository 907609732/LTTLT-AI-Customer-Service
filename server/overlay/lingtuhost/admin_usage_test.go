package lingtuhost

import (
 "net/http/httptest"
 "strings"
 "testing"
 "time"
 "github.com/QuantumNous/new-api/lingtu"
 "github.com/gin-gonic/gin"
)

func TestLingtuAdminUsageIncludesRecoveredRequestsAndReconcilesOnlyUncertain(t *testing.T) {
 db:=hostDB(t)
 if err:=db.AutoMigrate(&managedUsage{});err!=nil{t.Fatal(err)}
 store:=lingtu.NewTrialStore(db);now:=time.Now()
 if err:=store.Grant(91,now,20,7*24*time.Hour);err!=nil{t.Fatal(err)}
 if _,err:=store.ReserveWithLimits(91,"fixture-request","digest",now,lingtu.TrialLimits{PerAccountConcurrent:1,RequestsPerMinute:5,GlobalConcurrent:4,DailyCalls:200});err!=nil{t.Fatal(err)}
 host:=&Host{}
 request:=configurationRequest{UserID:91,RequestID:"fixture-request",Outcome:"failed",Reason:"Provider confirmed no charge"}
 if host.reconcileUsage(request)==nil{t.Fatal("pending request must not be manually settled")}
 if err:=store.Settle(91,"fixture-request","uncertain");err!=nil{t.Fatal(err)}
 recorder:=httptest.NewRecorder();c,_:=gin.CreateTestContext(recorder);c.Request=httptest.NewRequest("GET","/api/lingtu/admin/usage",nil)
 host.adminUsage(c)
 if recorder.Code!=200 || !strings.Contains(recorder.Body.String(),`"state":"uncertain"`){t.Fatalf("%d %s",recorder.Code,recorder.Body.String())}
 if err:=host.reconcileUsage(request);err!=nil{t.Fatal(err)}
 if host.reconcileUsage(request)==nil{t.Fatal("already finalized request must not be changed")}
 var grant lingtu.TrialGrant
 if err:=db.First(&grant,"user_id = ?",91).Error;err!=nil||grant.Used!=0||grant.Reserved!=0{t.Fatalf("refund invalid: %+v %v",grant,err)}
}
