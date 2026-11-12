package service

import (
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

func lingtuAdmissionFixture(t *testing.T) (*gin.Context, *model.Channel) {
	t.Helper()
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest("POST", "/v1/chat/completions", nil)
	base, override := "https://admitted.example.test", `{"X-Fixture":"checked"}`
	channel := &model.Channel{Id: 42, Type: 1, Status: common.ChannelStatusEnabled, Models: "checked-model", Key: "checked-key", BaseURL: &base, HeaderOverride: &override, Keys: []string{"checked-key"}, ChannelInfo: model.ChannelInfo{MultiKeyStatusList: map[int]int{0: 1}, MultiKeyDisabledReason: map[int]string{1: "checked"}, MultiKeyDisabledTime: map[int]int64{1: 123}}}
	c.Set("lingtu_internal", true)
	c.Set("lingtu_channel", channel.Id)
	c.Set("lingtu_upstream_model", channel.Models)
	c.Set("lingtu_internal_key", "internal-token")
	c.Set("token_key", "internal-token")
	c.Set("token_name", "lingtu-managed-internal")
	GetChannelConstraints(c).AddPin(dto.ChannelPin{ChannelId: channel.Id, Source: dto.PinSourceToken})
	return c, channel
}

func TestLingtuAdmittedChannelIsImmutable(t *testing.T) {
	c, channel := lingtuAdmissionFixture(t)
	if err := BindLingtuAdmittedChannel(c, channel); err != nil {
		t.Fatal(err)
	}
	channel.Key = "mutated"
	*channel.BaseURL = "https://mutated.example.test"
	*channel.HeaderOverride = "mutated"
	channel.Keys[0] = "mutated"
	channel.ChannelInfo.MultiKeyStatusList[0] = 2
	channel.ChannelInfo.MultiKeyDisabledReason[1] = "mutated"
	channel.ChannelInfo.MultiKeyDisabledTime[1] = 456
	for i := 0; i < 2; i++ {
		selected, _, err := SelectChannelForRequest(c, "checked-model", &RetryParam{})
		if err != nil || selected == nil {
			t.Fatal("admitted channel rejected", err)
		}
		if selected.Key != "checked-key" || *selected.BaseURL != "https://admitted.example.test" || *selected.HeaderOverride != `{"X-Fixture":"checked"}` || selected.Keys[0] != "checked-key" || selected.ChannelInfo.MultiKeyStatusList[0] != 1 || selected.ChannelInfo.MultiKeyDisabledReason[1] != "checked" || selected.ChannelInfo.MultiKeyDisabledTime[1] != 123 {
			t.Fatalf("admission shares mutable state: key=%t endpoint=%t override=%t keys=%t status=%t", selected.Key == "checked-key", *selected.BaseURL == "https://admitted.example.test", *selected.HeaderOverride == `{"X-Fixture":"checked"}`, selected.Keys[0] == "checked-key", selected.ChannelInfo.MultiKeyStatusList[0] == 1)
		}
		selected.Key = "mutated-again"
		*selected.BaseURL = "mutated-again"
		selected.ChannelInfo.MultiKeyStatusList[0] = 2
	}
}

func TestLingtuAdmittedChannelRequiresTrustedHandoff(t *testing.T) {
	cases := []struct {
		name   string
		change func(*gin.Context, *model.Channel)
		bind   bool
	}{
		{"missing-admission", func(c *gin.Context, ch *model.Channel) {}, false},
		{"public-context", func(c *gin.Context, ch *model.Channel) {
			c.Set("lingtu_internal", false)
			c.Request.Header.Set("X-Lingtu-Internal", "true")
		}, true},
		{"ordinary-token", func(c *gin.Context, ch *model.Channel) { c.Set("token_name", "ordinary") }, true},
		{"wrong-token", func(c *gin.Context, ch *model.Channel) { c.Set("token_key", "different") }, true},
		{"missing-token", func(c *gin.Context, ch *model.Channel) { c.Set("lingtu_internal_key", "") }, true},
		{"wrong-channel", func(c *gin.Context, ch *model.Channel) { c.Set("lingtu_channel", 43) }, true},
		{"wrong-model", func(c *gin.Context, ch *model.Channel) { c.Set("lingtu_upstream_model", "different") }, true},
		{"missing-pin", func(c *gin.Context, ch *model.Channel) { GetChannelConstraints(c).Pins = nil }, true},
		{"wrong-pin", func(c *gin.Context, ch *model.Channel) { GetChannelConstraints(c).Pins[0].ChannelId = 43 }, true},
		{"untrusted-pin", func(c *gin.Context, ch *model.Channel) {
			GetChannelConstraints(c).Pins[0].Source = dto.PinSourceOriginTask
		}, true},
		{"disabled", func(c *gin.Context, ch *model.Channel) { ch.Status = 2 }, true},
	}
	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			c, channel := lingtuAdmissionFixture(t)
			tt.change(c, channel)
			if tt.bind {
				if err := BindLingtuAdmittedChannel(c, channel); err != nil {
					t.Fatal(err)
				}
			}
			selected, _, err := SelectChannelForRequest(c, "checked-model", &RetryParam{})
			if selected != nil || err == nil || err.StatusCode != 403 {
				t.Fatal("untrusted admission accepted", err)
			}
		})
	}
}

func TestLingtuAdmissionLeavesNativeContextAlone(t *testing.T) {
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	for _, ctx := range []*gin.Context{nil, c} {
		channel, handled, err := selectLingtuAdmittedChannel(ctx, "native", &dto.ChannelConstraints{})
		if channel != nil || handled || err != nil {
			t.Fatal("ordinary native context intercepted")
		}
	}
}
