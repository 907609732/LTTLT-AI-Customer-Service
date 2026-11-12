package xunfei

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
)

var errManagedSparkRejected = errors.New("managed Spark request rejected")

// Managed non-stream calls require an explicit terminal success frame. Provider
// messages and WebSocket close text never enter returned errors or logs.
func managedSparkExchange(ctx context.Context, request dto.GeneralOpenAIRequest, domain, endpoint, appID string) (XunfeiChatResponse, error) {
	var result XunfeiChatResponse
	dialer := *websocket.DefaultDialer
	conn, resp, err := dialer.DialContext(ctx, endpoint, nil)
	if err != nil {
		if resp != nil && resp.Body != nil {
			_ = resp.Body.Close()
		}
		return result, errors.New("managed Spark connection failed")
	}
	defer conn.Close()
	stop := context.AfterFunc(ctx, func() { _ = conn.Close() })
	defer stop()
	if deadline, ok := ctx.Deadline(); ok {
		_ = conn.SetReadDeadline(deadline)
		_ = conn.SetWriteDeadline(deadline)
	}
	conn.SetReadLimit(2 * 1024 * 1024)
	if err := conn.WriteJSON(requestOpenAI2Xunfei(request, appID, domain)); err != nil {
		return result, errors.New("managed Spark request failed")
	}
	var content strings.Builder
	for {
		_, raw, err := conn.ReadMessage()
		if err != nil {
			if ctx.Err() != nil {
				return result, ctx.Err()
			}
			return result, errors.New("managed Spark response ended before completion")
		}
		var frame XunfeiChatResponse
		if json.Unmarshal(raw, &frame) != nil {
			return result, errors.New("invalid managed Spark response")
		}
		if frame.Header.Code != 0 {
			return result, errManagedSparkRejected
		}
		for _, text := range frame.Payload.Choices.Text {
			if content.Len()+len(text.Content) > 2*1024*1024 {
				return result, errors.New("managed Spark response too large")
			}
			content.WriteString(text.Content)
		}
		result = frame
		if frame.Payload.Choices.Status == 2 {
			if strings.TrimSpace(content.String()) == "" {
				return result, errors.New("empty managed Spark response")
			}
			result.Payload.Choices.Text = []XunfeiChatResponseTextItem{{Role: "assistant", Content: content.String()}}
			return result, nil
		}
	}
}

func managedSparkHandler(c *gin.Context, request dto.GeneralOpenAIRequest, appID, secret, key string) (*dto.Usage, *types.NewAPIError) {
	domain, endpoint := getXunfeiAuthUrl(c, key, secret, request.Model)
	timeout := 30 * time.Second
	if common.RelayTimeout > 0 {
		timeout = time.Duration(common.RelayTimeout) * time.Second
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), timeout)
	defer cancel()
	c.Set("lingtu_upstream_started", true)
	response, err := managedSparkExchange(ctx, request, domain, endpoint, appID)
	if err != nil {
		if errors.Is(err, errManagedSparkRejected) {
			c.Set("lingtu_upstream_status", 400)
		}
		return nil, types.NewError(errors.New("managed Spark model request failed"), types.ErrorCodeBadResponseBody, types.ErrOptionWithSkipRetry())
	}
	c.Set("lingtu_upstream_status", 200)
	raw, err := json.Marshal(responseXunfei2OpenAI(&response))
	if err != nil {
		return nil, types.NewError(errors.New("managed Spark response invalid"), types.ErrorCodeBadResponseBody, types.ErrOptionWithSkipRetry())
	}
	c.Writer.Header().Set("Content-Type", "application/json")
	_, _ = c.Writer.Write(raw)
	return &response.Payload.Usage.Text, nil
}
