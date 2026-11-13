package xunfei

import (
	"context"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/gorilla/websocket"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestLingtuSparkManagedExchangeRejectsBusinessAndPrematureFrames(t *testing.T) {
	for _, scenario := range []string{"business-error", "premature-close", "cancel", "success"} {
		t.Run(scenario, func(t *testing.T) {
			fixture := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				conn, err := (&websocket.Upgrader{}).Upgrade(w, r, nil)
				if err != nil {
					return
				}
				defer conn.Close()
				var request any
				if conn.ReadJSON(&request) != nil {
					return
				}
				switch scenario {
				case "business-error":
					conn.WriteMessage(websocket.TextMessage, []byte(`{"header":{"code":10013,"message":"spark-secret-sentinel"}}`))
				case "premature-close":
					return
				case "cancel":
					_, _, _ = conn.ReadMessage()
					return
				default:
					conn.WriteMessage(websocket.TextMessage, []byte(`{"header":{"code":0},"payload":{"choices":{"status":2,"text":[{"content":"fixture answer","role":"assistant"}]},"usage":{"text":{"prompt_tokens":1,"completion_tokens":2,"total_tokens":3}}}}`))
				}
			}))
			defer fixture.Close()
			timeout := time.Second
			if scenario == "cancel" {
				timeout = 50 * time.Millisecond
			}
			ctx, cancel := context.WithTimeout(context.Background(), timeout)
			defer cancel()
			response, err := managedSparkExchange(ctx, dto.GeneralOpenAIRequest{Model: "SparkDesk-v3.5"}, "generalv3.5", "ws"+strings.TrimPrefix(fixture.URL, "http"), "fixture-app")
			if scenario == "success" {
				if err != nil || len(response.Payload.Choices.Text) != 1 || response.Payload.Choices.Text[0].Content != "fixture answer" {
					t.Fatal("valid Spark response failed", err)
				}
			} else if err == nil {
				t.Fatal("Spark business rejection or premature termination accepted as success")
			} else if strings.Contains(err.Error(), "spark-secret-sentinel") {
				t.Fatal("provider business message escaped")
			}
		})
	}
}
