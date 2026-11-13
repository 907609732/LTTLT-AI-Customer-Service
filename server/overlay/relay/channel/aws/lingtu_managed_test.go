package aws

import (
	"context"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	sdk "github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/bedrockruntime"
	"github.com/gin-gonic/gin"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestLingtuManagedAwsSDKHasNoRetry(t *testing.T) {
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Set("lingtu_internal", true)
	info := &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{ApiKey: "fixture-key|us-east-1"}}
	client, err := newAwsClient(c, info)
	if err != nil {
		t.Fatal(err)
	}
	if client.Options().RetryMaxAttempts != 1 {
		t.Fatal("managed AWS SDK can retry", client.Options().RetryMaxAttempts)
	}
	if client.Options().Retryer == nil {
		t.Fatal("managed AWS retryer must be explicitly disabled")
	}
	calls := 0
	capture := func(options *bedrockruntime.Options) {
		options.HTTPClient = awsHTTPClientFunc(func(r *http.Request) (*http.Response, error) {
			calls++
			return &http.Response{StatusCode: 503, Header: http.Header{}, Body: io.NopCloser(strings.NewReader(`{"message":"temporary failure"}`))}, nil
		})
	}
	_, _ = client.InvokeModel(context.Background(), &bedrockruntime.InvokeModelInput{ModelId: sdk.String("fixture-model"), Body: []byte(`{}`)}, capture)
	if calls != 1 {
		t.Fatal("managed SDK emitted more than one outbound call", calls)
	}
}
