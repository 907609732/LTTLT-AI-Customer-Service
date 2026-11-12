package lingtuhost

import (
	"net/url"
	"sort"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

var usageBeijing = time.FixedZone("Asia/Shanghai", 8*60*60)

type usageDailyKey struct {
	Date          string `json:"date"`
	Model         string `json:"model"`
	ChannelID     int    `json:"channel_id"`
	ChannelName   string `json:"channel_name"`
	UpstreamModel string `json:"upstream_model"`
}

type usageDailyItem struct {
	usageDailyKey
	UsageSummaryTotals
}

type usageDailyRecord struct {
	Model         string
	ChannelID     int
	ChannelName   string
	UpstreamModel string
	State         string
	CreatedAt     int64
	InputTokens   int64
	OutputTokens  int64
	UsageKnown    bool
}

func dailyUsageParameters(c *gin.Context) (int, string, bool) {
	query, err := url.ParseQuery(c.Request.URL.RawQuery)
	if err != nil {
		return 0, "", false
	}
	days := 7
	if values, present := query["days"]; present {
		if len(values) != 1 || (values[0] != "7" && values[0] != "30") {
			return 0, "", false
		}
		if values[0] == "30" {
			days = 30
		}
	}
	selected := ""
	if values, present := query["model"]; present {
		if len(values) != 1 || values[0] == "" || len(values[0]) > 128 || !utf8.ValidString(values[0]) || strings.TrimSpace(values[0]) != values[0] || strings.ContainsFunc(values[0], unicode.IsControl) {
			return 0, "", false
		}
		selected = values[0]
	}
	return days, selected, true
}

func addDailyUsage(totals *UsageSummaryTotals, record usageDailyRecord) {
	totals.Requests++
	switch record.State {
	case "success":
		totals.Successes++
	case "failed":
		totals.Failed++
	case "uncertain":
		totals.Uncertain++
	}
	if record.UsageKnown {
		totals.InputTokens += record.InputTokens
		totals.OutputTokens += record.OutputTokens
		totals.TotalTokens += record.InputTokens + record.OutputTokens
	} else {
		totals.UnknownUsage++
	}
}

func (h *Host) adminUsageDaily(c *gin.Context) {
	h.adminUsageDailyAt(c, time.Now())
}

func (h *Host) adminUsageDailyAt(c *gin.Context, now time.Time) {
	days, selected, ok := dailyUsageParameters(c)
	if !ok {
		clientFailure(c, 400, "invalid_request")
		return
	}
	local := now.In(usageBeijing)
	today := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, usageBeijing)
	start, end := today.AddDate(0, 0, 1-days), today.AddDate(0, 0, 1)
	// The request ledger owns the call count and request day. A missing usage
	// snapshot remains unknown; orphan usage and connection probes are excluded.
	// Stream only the bounded range, without dialect-specific date SQL. Filtering
	// in Go also preserves exact model spelling under MySQL's default collation.
	query := model.DB.WithContext(c.Request.Context()).Table("lingtu_trial_requests AS r").
		Joins("LEFT JOIN lingtu_usage AS u ON u.user_id = r.user_id AND u.request_id = r.request_id").
		Where("r.created_at >= ? AND r.created_at < ?", start.Unix(), end.Unix()).
		Select("r.state, r.created_at, COALESCE(u.model, '') AS model, COALESCE(u.channel_id, 0) AS channel_id, COALESCE(u.channel_name, '') AS channel_name, COALESCE(u.upstream_model, '') AS upstream_model, COALESCE(u.input_tokens, 0) AS input_tokens, COALESCE(u.output_tokens, 0) AS output_tokens, COALESCE(u.usage_known, FALSE) AS usage_known")
	rows, err := query.Rows()
	if err != nil {
		clientFailure(c, 503, "usage_unavailable")
		return
	}
	defer rows.Close()
	groups := map[usageDailyKey]*usageDailyItem{}
	models := map[string]bool{}
	activeDates := map[string]bool{}
	var totals, todayTotals UsageSummaryTotals
	todayDate := today.Format("2006-01-02")
	for rows.Next() {
		var record usageDailyRecord
		if err := model.DB.ScanRows(rows, &record); err != nil {
			clientFailure(c, 503, "usage_unavailable")
			return
		}
		if record.Model != "" {
			models[record.Model] = true
		}
		if selected != "" && record.Model != selected {
			continue
		}
		date := time.Unix(record.CreatedAt, 0).In(usageBeijing).Format("2006-01-02")
		key := usageDailyKey{Date: date, Model: record.Model, ChannelID: record.ChannelID, ChannelName: record.ChannelName, UpstreamModel: record.UpstreamModel}
		if groups[key] == nil {
			groups[key] = &usageDailyItem{usageDailyKey: key}
		}
		addDailyUsage(&groups[key].UsageSummaryTotals, record)
		addDailyUsage(&totals, record)
		if date == todayDate {
			addDailyUsage(&todayTotals, record)
		}
		activeDates[date] = true
	}
	if rows.Err() != nil {
		clientFailure(c, 503, "usage_unavailable")
		return
	}
	items := make([]usageDailyItem, 0, len(groups)+days)
	for _, item := range groups {
		items = append(items, *item)
	}
	for day := start; day.Before(end); day = day.AddDate(0, 0, 1) {
		date := day.Format("2006-01-02")
		if !activeDates[date] {
			items = append(items, usageDailyItem{usageDailyKey: usageDailyKey{Date: date}})
		}
	}
	sort.Slice(items, func(i, j int) bool {
		a, b := items[i], items[j]
		if a.Date != b.Date {
			return a.Date < b.Date
		}
		if a.Model != b.Model {
			return a.Model < b.Model
		}
		if a.ChannelID != b.ChannelID {
			return a.ChannelID < b.ChannelID
		}
		if a.ChannelName != b.ChannelName {
			return a.ChannelName < b.ChannelName
		}
		return a.UpstreamModel < b.UpstreamModel
	})
	options := make([]string, 0, len(models))
	for name := range models {
		options = append(options, name)
	}
	sort.Strings(options)
	c.JSON(200, gin.H{"scope": "clients_only", "timezone": "Asia/Shanghai", "days": days, "model": selected, "today": todayTotals, "totals": totals, "items": items, "model_options": options})
}
