package lingtuhost

import (
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/lingtu"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type UsageSummaryTotals struct {
	Requests     int64 `json:"requests"`
	Successes    int64 `json:"successes"`
	Failed       int64 `json:"failed"`
	Uncertain    int64 `json:"uncertain"`
	InputTokens  int64 `json:"input_tokens"`
	OutputTokens int64 `json:"output_tokens"`
	TotalTokens  int64 `json:"total_tokens" gorm:"-"`
	UnknownUsage int64 `json:"unknown_usage"`
}
type usageSummaryTotals = UsageSummaryTotals
type usageAccountSummary struct {
	UsageSummaryTotals
	UserID      int    `json:"user_id"`
	DisplayName string `json:"display_name"`
	LastUsedAt  int64  `json:"last_used_at"`
}

func positiveQuery(c *gin.Context, name string, fallback int) (int, bool) {
	values, present := c.Request.URL.Query()[name]
	if !present {
		return fallback, true
	}
	if len(values) != 1 || values[0] == "" {
		return 0, false
	}
	for _, r := range values[0] {
		if r < '0' || r > '9' {
			return 0, false
		}
	}
	value, err := strconv.Atoi(values[0])
	return value, err == nil && value > 0
}
func usageParameters(c *gin.Context) (int, int, bool) {
	page, ok := positiveQuery(c, "page", 1)
	if !ok || page > int(^uint(0)>>1)/20 {
		clientFailure(c, 400, "invalid_request")
		return 0, 0, false
	}
	uid, ok := positiveQuery(c, "user_id", 0)
	if !ok {
		clientFailure(c, 400, "invalid_request")
		return 0, 0, false
	}
	return page, uid, true
}
func usageQuery(uid int) *gorm.DB {
	query := model.DB.Table("lingtu_trial_requests AS r").Joins("LEFT JOIN lingtu_usage AS u ON u.user_id = r.user_id AND u.request_id = r.request_id").Joins("LEFT JOIN users AS profile ON profile.id = r.user_id")
	if uid > 0 {
		query = query.Where("r.user_id = ?", uid)
	}
	return query
}

const usageDisplayName = "CASE WHEN COALESCE(profile.display_name, '') = '' THEN COALESCE(profile.username, '') ELSE profile.display_name END"

func (h *Host) adminUsage(c *gin.Context) {
	page, uid, ok := usageParameters(c)
	if !ok {
		return
	}
	var total int64
	items := []struct {
		UserID       int    `json:"user_id"`
		DisplayName  string `json:"display_name"`
		RequestID    string `json:"request_id"`
		State        string `json:"state"`
		CreatedAt    int64  `json:"created_at"`
		Model        string `json:"model"`
		InputTokens  int64  `json:"input_tokens"`
		OutputTokens int64  `json:"output_tokens"`
		TotalTokens  int64  `json:"total_tokens" gorm:"-"`
		UsageKnown   bool   `json:"usage_known"`
		Diagnostic   string `json:"diagnostic"`
	}{}
	if usageQuery(uid).Count(&total).Error != nil || usageQuery(uid).Select("r.user_id, "+usageDisplayName+" AS display_name, r.request_id, r.state, r.created_at, COALESCE(u.model, '') AS model, COALESCE(u.input_tokens, 0) AS input_tokens, COALESCE(u.output_tokens, 0) AS output_tokens, COALESCE(u.usage_known, FALSE) AS usage_known, COALESCE(u.diagnostic, '') AS diagnostic").Order("r.id DESC").Offset((page-1)*20).Limit(20).Scan(&items).Error != nil {
		clientFailure(c, 503, "usage_unavailable")
		return
	}
	for i := range items {
		items[i].TotalTokens = items[i].InputTokens + items[i].OutputTokens
	}
	c.JSON(200, gin.H{"scope": "clients_only", "items": items, "total": total, "page": page})
}

const usageAggregate = `COUNT(*) AS requests,
 COALESCE(SUM(CASE WHEN r.state = 'success' THEN 1 ELSE 0 END),0) AS successes,
 COALESCE(SUM(CASE WHEN r.state = 'failed' THEN 1 ELSE 0 END),0) AS failed,
 COALESCE(SUM(CASE WHEN r.state = 'uncertain' THEN 1 ELSE 0 END),0) AS uncertain,
 COALESCE(SUM(CASE WHEN COALESCE(u.usage_known,FALSE) THEN COALESCE(u.input_tokens,0) ELSE 0 END),0) AS input_tokens,
 COALESCE(SUM(CASE WHEN COALESCE(u.usage_known,FALSE) THEN COALESCE(u.output_tokens,0) ELSE 0 END),0) AS output_tokens,
 COALESCE(SUM(CASE WHEN COALESCE(u.usage_known,FALSE) THEN 0 ELSE 1 END),0) AS unknown_usage`

func (h *Host) adminUsageSummary(c *gin.Context) {
	page, uid, ok := usageParameters(c)
	if !ok {
		return
	}
	var totals usageSummaryTotals
	var total int64
	items := []usageAccountSummary{}
	if usageQuery(uid).Select(usageAggregate).Scan(&totals).Error != nil || usageQuery(uid).Distinct("r.user_id").Count(&total).Error != nil || usageQuery(uid).Select("r.user_id, "+usageDisplayName+" AS display_name, "+usageAggregate+", MAX(r.created_at) AS last_used_at").Group("r.user_id, profile.display_name, profile.username").Order("last_used_at DESC, r.user_id DESC").Offset((page-1)*20).Limit(20).Scan(&items).Error != nil {
		clientFailure(c, 503, "usage_unavailable")
		return
	}
	totals.TotalTokens = totals.InputTokens + totals.OutputTokens
	for i := range items {
		items[i].TotalTokens = items[i].InputTokens + items[i].OutputTokens
	}
	c.JSON(200, gin.H{"scope": "clients_only", "totals": totals, "items": items, "total": total, "page": page})
}

// Reconciliation changes accounting only. It never resends a provider request.
func (h *Host) reconcileUsage(r configurationRequest) error {
	if r.UserID <= 0 || len(r.RequestID) < 1 || len(r.RequestID) > 128 || len(strings.TrimSpace(r.Reason)) < 3 || len(r.Reason) > 500 || (r.Outcome != "success" && r.Outcome != "failed") {
		return lingtu.ErrInvalidTrialInput
	}
	return model.DB.Transaction(func(tx *gorm.DB) error {
		var request lingtu.TrialRequest
		if err := tx.Where("user_id = ? AND request_id = ?", r.UserID, r.RequestID).First(&request).Error; err != nil {
			return err
		}
		if request.State != "uncertain" {
			return lingtu.ErrSettlementConflict
		}
		return lingtu.NewTrialStore(tx).Settle(r.UserID, r.RequestID, r.Outcome)
	})
}
