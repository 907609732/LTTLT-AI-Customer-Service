package lingtuhost

import (
 "strconv"
 "strings"

 "github.com/QuantumNous/new-api/lingtu"
 "github.com/QuantumNous/new-api/model"
 "github.com/gin-gonic/gin"
 "gorm.io/gorm"
)

func (h *Host) adminUsage(c *gin.Context) {
 page, _ := strconv.Atoi(c.Query("page")); page=max(1,page)
 var total int64
 var items []struct {
  UserID int `json:"user_id"`
  RequestID string `json:"request_id"`
  State string `json:"state"`
  CreatedAt int64 `json:"created_at"`
  Model string `json:"model"`
  InputTokens int `json:"input_tokens"`
  OutputTokens int `json:"output_tokens"`
  Diagnostic string `json:"diagnostic"`
 }
 query:=model.DB.Table("lingtu_trial_requests AS r").Joins("LEFT JOIN lingtu_usage AS u ON u.user_id = r.user_id AND u.request_id = r.request_id")
 if query.Count(&total).Error!=nil || query.Select("r.user_id, r.request_id, r.state, r.created_at, COALESCE(u.model, '') AS model, COALESCE(u.input_tokens, 0) AS input_tokens, COALESCE(u.output_tokens, 0) AS output_tokens, COALESCE(u.diagnostic, '') AS diagnostic").Order("r.id DESC").Offset((page-1)*20).Limit(20).Scan(&items).Error!=nil {
  clientFailure(c,503,"usage_unavailable");return
 }
 c.JSON(200,gin.H{"items":items,"total":total,"page":page})
}

// Reconciliation changes accounting only. It never resends a provider request.
func (h *Host) reconcileUsage(r configurationRequest) error {
 if r.UserID<=0 || len(r.RequestID)<1 || len(r.RequestID)>128 || len(strings.TrimSpace(r.Reason))<3 || len(r.Reason)>500 || (r.Outcome!="success" && r.Outcome!="failed") { return lingtu.ErrInvalidTrialInput }
 return model.DB.Transaction(func(tx *gorm.DB) error {
  var request lingtu.TrialRequest
  if err:=tx.Where("user_id = ? AND request_id = ?",r.UserID,r.RequestID).First(&request).Error;err!=nil{return err}
  if request.State!="uncertain" {return lingtu.ErrSettlementConflict}
  return lingtu.NewTrialStore(tx).Settle(r.UserID,r.RequestID,r.Outcome)
 })
}
