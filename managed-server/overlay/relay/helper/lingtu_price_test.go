package helper

import (
 "net/http/httptest"
 "testing"

 relaycommon "github.com/QuantumNous/new-api/relay/common"
 "github.com/QuantumNous/new-api/relaykit/dto"
 "github.com/QuantumNous/new-api/relaykit/types"
 "github.com/QuantumNous/new-api/setting/ratio_setting"
 "github.com/gin-gonic/gin"
)
func TestLingtuCountedRelayDoesNotRequireSeparateNativeCredit(t *testing.T){
 ratio_setting.InitRatioSettings();c,_:=gin.CreateTestContext(httptest.NewRecorder());c.Set("lingtu_internal",true)
 info:=&relaycommon.RelayInfo{OriginModelName:"qwen-plus",UserGroup:"default",TokenGroup:"default",UserSetting:dto.UserSetting{AcceptUnsetRatioModel:true}}
 price,err:=ModelPriceHelper(c,info,100,&types.TokenCountMeta{})
 if err!=nil||!price.FreeModel||price.QuotaToPreConsume!=0||!info.PriceData.FreeModel{t.Fatalf("separate native debit: %+v %v",price,err)}
}
