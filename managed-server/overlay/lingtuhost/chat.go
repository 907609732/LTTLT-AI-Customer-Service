package lingtuhost

import (
	"bufio"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/controller"
	"github.com/QuantumNous/new-api/lingtu"

	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"gorm.io/gorm/schema"
)

const internalTokenName = "lingtu-managed-internal"

var internalTokenMu sync.Mutex
var chatCleanupMu sync.Mutex
var chatCleanupHosts []*Host

// Shutdown stops registered managed-host background jobs.
func Shutdown() {
	chatCleanupMu.Lock()
	defer chatCleanupMu.Unlock()
	for _, h := range chatCleanupHosts {
		h.Shutdown()
	}
	chatCleanupHosts = nil
}

// relayBuffer never exposes provider headers or bytes to the real writer.
type relayBuffer struct {
	gin.ResponseWriter
	body              bytes.Buffer
	headers           http.Header
	code, size, limit int
	tooLarge          bool
}

func newRelayBuffer(w gin.ResponseWriter, limit int) *relayBuffer {
	return &relayBuffer{ResponseWriter: w, headers: make(http.Header), code: 200, size: -1, limit: limit}
}
func (b *relayBuffer) Header() http.Header { return b.headers }
func (b *relayBuffer) WriteHeader(code int) {
	if b.size < 0 {
		b.code = code
	}
}
func (b *relayBuffer) WriteHeaderNow() {
	if b.size < 0 {
		b.size = 0
	}
}
func (b *relayBuffer) Write(data []byte) (int, error) {
	b.WriteHeaderNow()
	if len(data) > b.limit-b.body.Len() {
		b.tooLarge = true
		return len(data), nil
	}
	b.size += len(data)
	return b.body.Write(data)
}
func (b *relayBuffer) WriteString(s string) (int, error) { return b.Write([]byte(s)) }
func (b *relayBuffer) Status() int                       { return b.code }
func (b *relayBuffer) Size() int                         { return b.size }
func (b *relayBuffer) Written() bool                     { return b.size >= 0 }
func (b *relayBuffer) Flush()                            { b.WriteHeaderNow() }
func (b *relayBuffer) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	return nil, nil, errors.New("managed relay does not support hijacking")
}
func (b *relayBuffer) Pusher() http.Pusher      { return nil }
func (b *relayBuffer) CloseNotify() <-chan bool { return make(chan bool) }

type managedUsage struct {
	UserID       int    `gorm:"primaryKey;autoIncrement:false"`
	RequestID    string `gorm:"type:varchar(128);primaryKey"`
	Model        string `gorm:"type:varchar(128)"`
	InputTokens  int
	OutputTokens int
	Diagnostic   string `gorm:"type:varchar(64)"`
	CreatedAt    int64  `gorm:"autoCreateTime:false;index"`
}

func (managedUsage) TableName() string { return "lingtu_usage" }

// MySQL TEXT is limited to 64KiB; bounded encrypted responses need LONGTEXT.
type resultCiphertext string

func (resultCiphertext) GormDataType() string { return "string" }
func (resultCiphertext) GormDBDataType(db *gorm.DB, _ *schema.Field) string {
	if db.Dialector.Name() == "mysql" {
		return "LONGTEXT"
	}
	return "TEXT"
}

type managedResult struct {
	UserID    int              `gorm:"primaryKey;autoIncrement:false"`
	RequestID string           `gorm:"type:varchar(128);primaryKey"`
	Digest    string           `gorm:"type:varchar(128);not null"`
	Payload   resultCiphertext `gorm:"not null"`
	ExpiresAt int64            `gorm:"not null;index"`
}

func (managedResult) TableName() string        { return "lingtu_results" }
func resultContext(uid int, rid string) string { return fmt.Sprintf("result/%d/%s", uid, rid) }
func (h *Host) migrateChat() error {
	if err := model.DB.AutoMigrate(&managedUsage{}, &managedResult{}); err != nil {
		return err
	}
	if err := h.trials.Migrate(); err != nil {
		return err
	}
	if err := h.trials.RecoverPending(); err != nil {
		return err
	}
	return model.DB.Where("expires_at <= ?", time.Now().Unix()).Delete(&managedResult{}).Error
}

// Shutdown stops background result expiry cleanup when the server shuts down.
func (h *Host) Shutdown() {
	if h.cleanupStop != nil {
		h.cleanupOnce.Do(func() { close(h.cleanupStop) })
	}
}
func (h *Host) startChatCleanup() {
	h.cleanupStop = make(chan struct{})
	chatCleanupMu.Lock()
	chatCleanupHosts = append(chatCleanupHosts, h)
	chatCleanupMu.Unlock()
	go func() {
		ticker := time.NewTicker(time.Minute)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				_ = model.DB.Where("expires_at <= ?", time.Now().Unix()).Delete(&managedResult{}).Error
			case <-h.cleanupStop:
				return
			}
		}
	}()
}

type chatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}
type chatInput struct {
	RequestID string        `json:"client_request_id"`
	Messages  []chatMessage `json:"messages"`
}

func parseChat(r io.Reader) (chatInput, string, error) {
	var in chatInput
	raw, err := io.ReadAll(io.LimitReader(r, 128*1024+1))
	if err != nil || len(raw) > 128*1024 {
		return in, "", errors.New("invalid request")
	}
	if json.Unmarshal(raw, &in) != nil || len(in.RequestID) < 1 || len(in.RequestID) > 128 || len(in.Messages) < 1 || len(in.Messages) > 64 {
		return in, "", errors.New("invalid request")
	}
	for _, m := range in.Messages {
		if (m.Role != "system" && m.Role != "user" && m.Role != "assistant") || len(m.Content) > 32768 {
			return in, "", errors.New("invalid message")
		}
	}
	canonical, _ := json.Marshal(in.Messages)
	digest := sha256.Sum256(canonical)
	return in, hex.EncodeToString(digest[:]), nil
}
func selectedChannel(selected string) (model.Channel, error) {
	name := ""
	switch selected {
	case "deepseek-flash":
		name = "lingtu-deepseek"
	case "qwen-plus":
		name = "lingtu-qwen"
	default:
		return model.Channel{}, errors.New("unknown model")
	}
	var channel model.Channel
	if err := model.DB.Where("name = ? AND type = ? AND status = ?", name, 1, common.ChannelStatusEnabled).First(&channel).Error; err != nil {
		return channel, err
	}
	if strings.TrimSpace(channel.Key) == "" {
		return channel, errors.New("missing key")
	}
	for _, m := range strings.Split(channel.Models, ",") {
		if strings.TrimSpace(m) == selected {
			return channel, nil
		}
	}
	return channel, errors.New("model missing")
}
func resolveInternalToken() (model.Token, error) {
	internalTokenMu.Lock()
	defer internalTokenMu.Unlock()
	var root model.User
	if err := model.DB.Where("role = ? AND status = ?", common.RoleRootUser, common.UserStatusEnabled).First(&root).Error; err != nil {
		return model.Token{}, err
	}
	var token model.Token
	err := model.DB.Where("name = ?", internalTokenName).First(&token).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		key, keyErr := common.GenerateKey()
		if keyErr != nil {
			return token, keyErr
		}
		token = model.Token{UserId: root.Id, Key: key, Name: internalTokenName, Status: common.TokenStatusEnabled, UnlimitedQuota: true, ModelLimitsEnabled: true, ModelLimits: "deepseek-flash,qwen-plus", ExpiredTime: -1, CreatedTime: time.Now().Unix(), Group: "default"}
		err = model.DB.Create(&token).Error
	}
	if err != nil {
		return token, err
	}
	if token.UserId != root.Id || token.Status != common.TokenStatusEnabled || !token.UnlimitedQuota || !token.ModelLimitsEnabled || token.ModelLimits != "deepseek-flash,qwen-plus" || token.ExpiredTime != -1 || token.Key == "" {
		return token, errors.New("invalid internal token")
	}
	return token, nil
}
func (h *Host) injectInternalToken(c *gin.Context) {
	token, err := resolveInternalToken()
	if err != nil {
		clientFailure(c, 503, "model_not_ready")
		return
	}
	c.Set("lingtu_internal_key", token.Key)
	c.Request.Header.Set("Authorization", "Bearer sk-"+token.Key+"-"+strconv.Itoa(c.GetInt("lingtu_channel")))
	c.Next()
}
func (h *Host) nativeChat(c *gin.Context) {
	setting, _ := common.GetContextKeyType[dto.UserSetting](c, constant.ContextKeyUserSetting)
	setting.AcceptUnsetRatioModel = true
	common.SetContextKey(c, constant.ContextKeyUserSetting, setting)
	controller.Relay(c, types.RelayFormatOpenAI)
}
func (h *Host) deliveryAllowed(c *gin.Context, jwt string) bool {
	if _, err := h.sessions.Authenticate(jwt, time.Now()); err != nil {
		clientFailure(c, 401, "session_expired")
		return false
	}
	var account lingtu.ManagedAccount
	if model.DB.First(&account, "user_id = ?", identityOf(c).UserID).Error != nil || account.Status != "enabled" {
		clientFailure(c, 403, "account_disabled")
		return false
	}
	return true
}
func (h *Host) serveExisting(c *gin.Context, in chatInput, digest, jwt string) bool {
	uid := identityOf(c).UserID
	var request lingtu.TrialRequest
	err := model.DB.Where("user_id = ? AND request_id = ?", uid, in.RequestID).First(&request).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return false
	}
	if err != nil {
		clientFailure(c, 503, "temporarily_unavailable")
		return true
	}
	if request.Digest != digest {
		clientFailure(c, 409, "request_conflict")
		return true
	}
	switch request.State {
	case "pending", "uncertain":
		clientFailure(c, 409, "request_"+request.State)
	case "success":
		var result managedResult
		if model.DB.Where("user_id = ? AND request_id = ? AND expires_at > ?", uid, in.RequestID, time.Now().Unix()).First(&result).Error != nil || result.Digest != digest {
			clientFailure(c, 410, "result_expired")
			return true
		}
		vault, err := lingtu.RuntimeVault()
		if err != nil {
			clientFailure(c, 503, "temporarily_unavailable")
			return true
		}
		plain, err := vault.Open(resultContext(uid, in.RequestID), string(result.Payload))
		if err != nil {
			clientFailure(c, 410, "result_expired")
			return true
		}
		if h.deliveryAllowed(c, jwt) {
			c.Data(200, "application/json", plain)
			c.Abort()
		}
	default:
		clientFailure(c, 410, "request_failed")
	}
	return true
}
func trialFailure(c *gin.Context, err error) {
	switch {
	case errors.Is(err, lingtu.ErrRequestConflict):
		clientFailure(c, 409, "request_conflict")
	case errors.Is(err, lingtu.ErrTrialRateLimit):
		clientFailure(c, 429, "rate_limited")
	case errors.Is(err, lingtu.ErrAccountConcurrency) || errors.Is(err, lingtu.ErrGlobalConcurrency):
		clientFailure(c, 429, "service_busy")
	case errors.Is(err, lingtu.ErrDailyCallLimit):
		clientFailure(c, 403, "daily_limit")
	case errors.Is(err, lingtu.ErrTrialUnavailable):
		var grant lingtu.TrialGrant
		code := "trial_exhausted"
		if model.DB.First(&grant, "user_id = ?", identityOf(c).UserID).Error == nil && grant.ExpiresAt <= time.Now().Unix() {
			code = "trial_expired"
		}
		clientFailure(c, 403, code)
	default:
		clientFailure(c, 503, "temporarily_unavailable")
	}
}
func (h *Host) prepareChat(c *gin.Context) {
	in, digest, err := parseChat(c.Request.Body)
	if err != nil {
		clientFailure(c, 400, "invalid_request")
		return
	}
	jwt := strings.TrimPrefix(c.GetHeader("Authorization"), "Bearer ")
	if h.serveExisting(c, in, digest, jwt) {
		return
	}
	policy, err := lingtu.LoadTrialPolicy(model.DB)
	if err != nil {
		clientFailure(c, 503, "configuration_unavailable")
		return
	}
	var account lingtu.ManagedAccount
	uid := identityOf(c).UserID
	if model.DB.First(&account, "user_id = ?", uid).Error != nil || account.Status != "enabled" {
		clientFailure(c, 403, "account_disabled")
		return
	}
	selected := account.Model
	if selected == "" {
		selected = policy.DefaultModel
	}
	channel, err := selectedChannel(selected)
	if err != nil {
		clientFailure(c, 503, "model_not_ready")
		return
	}
	reservation, err := h.trials.ReserveWithLimits(uid, in.RequestID, digest, time.Now(), lingtu.TrialLimits{PerAccountConcurrent: policy.PerAccountConcurrent, RequestsPerMinute: policy.RequestsPerMinute, GlobalConcurrent: policy.GlobalConcurrent, DailyCalls: policy.DailyCalls})
	if err != nil {
		trialFailure(c, err)
		return
	}
	if !reservation.Created {
		if !h.serveExisting(c, in, digest, jwt) {
			clientFailure(c, 503, "temporarily_unavailable")
		}
		return
	}
	usage := managedUsage{UserID: uid, RequestID: in.RequestID, Model: selected, Diagnostic: "pending", CreatedAt: time.Now().Unix()}
	if err = model.DB.Create(&usage).Error; err != nil {
		_ = h.trials.Settle(uid, in.RequestID, "failed")
		clientFailure(c, 503, "temporarily_unavailable")
		return
	}
	originalWriter := c.Writer
	capture := newRelayBuffer(originalWriter, 2*1024*1024)
	originalHeaders := c.Request.Header
	originalPath, originalQuery, originalURI := c.Request.URL.Path, c.Request.URL.RawQuery, c.Request.RequestURI
	c.Writer = capture
	c.Request.Header = make(http.Header)
	c.Request.Header.Set("Content-Type", "application/json")
	serverRequestID := sha256.Sum256([]byte(fmt.Sprintf("%d/%s", uid, in.RequestID)))
	safeRequestID := hex.EncodeToString(serverRequestID[:])
	c.Request.Header.Set("X-Request-Id", safeRequestID)
	c.Request.URL.Path = "/v1/chat/completions"
	c.Request.URL.RawQuery = ""
	c.Request.RequestURI = "/v1/chat/completions"
	requestBody, _ := json.Marshal(gin.H{"model": selected, "messages": in.Messages, "stream": false, "max_tokens": policy.MaxTokens})
	c.Request.Body = io.NopCloser(bytes.NewReader(requestBody))
	c.Request.ContentLength = int64(len(requestBody))
	c.Set("lingtu_internal", true)
	c.Set("lingtu_channel", channel.Id)
	c.Set(common.RequestIdKey, safeRequestID)
	// All exits, including panic, settle conservatively and restore the real writer.
	defer func() {
		panicValue := recover()
		c.Writer = originalWriter
		c.Request.Header = originalHeaders
		c.Request.URL.Path = originalPath
		c.Request.URL.RawQuery = originalQuery
		c.Request.RequestURI = originalURI
		outcome, diagnostic := "failed", "relay_rejected"
		started := c.GetBool("lingtu_upstream_started")
		upstreamStatus := c.GetInt("lingtu_upstream_status")
		if started {
			outcome = "uncertain"
			diagnostic = "upstream_uncertain"
		}
		if started && upstreamStatus >= 400 && upstreamStatus < 500 {
			outcome = "failed"
			diagnostic = "upstream_rejected"
		}
		var plain []byte
		if panicValue == nil && started && upstreamStatus >= 200 && upstreamStatus < 300 && capture.Status() == 200 && !capture.tooLarge {
			plain, usage.InputTokens, usage.OutputTokens = sanitizeResponse(capture.body.Bytes(), selected, append(channel.GetKeys(), c.GetString("lingtu_internal_key"))...)
			if len(plain) > 0 {
				outcome = "success"
				diagnostic = "success"
			}
		}
		usage.Diagnostic = diagnostic
		err := model.DB.Transaction(func(tx *gorm.DB) error {
			if outcome == "success" {
				vault, e := lingtu.RuntimeVault()
				if e != nil {
					return e
				}
				sealed, e := vault.Seal(resultContext(uid, in.RequestID), plain)
				if e != nil {
					return e
				}
				if e = tx.Create(&managedResult{UserID: uid, RequestID: in.RequestID, Digest: digest, Payload: resultCiphertext(sealed), ExpiresAt: time.Now().Add(15 * time.Minute).Unix()}).Error; e != nil {
					return e
				}
			}
			if e := tx.Clauses(clause.OnConflict{UpdateAll: true}).Create(&usage).Error; e != nil {
				return e
			}
			return lingtu.NewTrialStore(tx).Settle(uid, in.RequestID, outcome)
		})
		if err != nil {
			_ = h.trials.Settle(uid, in.RequestID, "uncertain")
			clientFailure(c, 503, "request_uncertain")
			return
		}
		if outcome == "success" {
			if h.deliveryAllowed(c, jwt) {
				c.Data(200, "application/json", plain)
				c.Abort()
			}
			return
		}
		if outcome == "uncertain" {
			clientFailure(c, 503, "request_uncertain")
		} else {
			clientFailure(c, 503, "model_unavailable")
		}
	}()
	c.Next()
}
func sanitizeResponse(raw []byte, selected string, secrets ...string) ([]byte, int, int) {
	var response struct {
		Choices []struct {
			Message struct {
				Role    string `json:"role"`
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
		Usage struct {
			Input  int `json:"prompt_tokens"`
			Output int `json:"completion_tokens"`
		} `json:"usage"`
	}
	if json.Unmarshal(raw, &response) != nil || len(response.Choices) < 1 {
		return nil, 0, 0
	}
	content := response.Choices[0].Message.Content
	if strings.TrimSpace(content) == "" || response.Usage.Input < 0 || response.Usage.Output < 0 {
		return nil, 0, 0
	}
	for _, secret := range secrets {
		if secret != "" && strings.Contains(content, secret) {
			return nil, 0, 0
		}
	}
	clean, _ := json.Marshal(gin.H{"model": selected, "choices": []gin.H{{"index": 0, "message": gin.H{"role": "assistant", "content": content}, "finish_reason": "stop"}}, "usage": gin.H{"prompt_tokens": response.Usage.Input, "completion_tokens": response.Usage.Output, "total_tokens": response.Usage.Input + response.Usage.Output}})
	return clean, response.Usage.Input, response.Usage.Output
}
