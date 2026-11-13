package service

import (
	"context"
	"maps"
	"net/http"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

type lingtuAdmissionKey struct{}

// BindLingtuAdmittedChannel freezes the exact readiness-checked native config.
// Only server code can create this private request-context value; it is never
// reconstructed from a header, request body, channel ID, or mutable native cache.
func BindLingtuAdmittedChannel(c *gin.Context, channel *model.Channel) error {
	snapshot, err := cloneLingtuChannel(channel)
	if err != nil {
		return err
	}
	c.Request = c.Request.WithContext(context.WithValue(c.Request.Context(), lingtuAdmissionKey{}, snapshot))
	return nil
}

func selectLingtuAdmittedChannel(c *gin.Context, modelName string, constraints *dto.ChannelConstraints) (*model.Channel, bool, *ChannelSelectError) {
	if c == nil {
		return nil, false, nil
	}
	var admitted *model.Channel
	if c.Request != nil {
		admitted, _ = c.Request.Context().Value(lingtuAdmissionKey{}).(*model.Channel)
	}
	if admitted == nil && c.GetInt("lingtu_channel") == 0 {
		return nil, false, nil
	}
	reject := func() (*model.Channel, bool, *ChannelSelectError) {
		return nil, true, &ChannelSelectError{StatusCode: http.StatusForbidden, Message: "managed_channel_admission_required"}
	}
	pin, pinned, _ := constraints.ResolvedPin()
	if admitted == nil || !c.GetBool("lingtu_internal") ||
		c.GetString("token_name") != "lingtu-managed-internal" ||
		c.GetString("lingtu_internal_key") == "" || c.GetString("token_key") != c.GetString("lingtu_internal_key") ||
		!pinned || pin.Source != dto.PinSourceToken || pin.ChannelId != admitted.Id ||
		c.GetInt("lingtu_channel") != admitted.Id || admitted.Id <= 0 ||
		admitted.Status != common.ChannelStatusEnabled ||
		modelName != admitted.Models || c.GetString("lingtu_upstream_model") != admitted.Models {
		return reject()
	}
	if ok, _ := model.ChannelSatisfiesFilters(admitted, modelName, constraints.Filters); !ok {
		return reject()
	}
	// Native key selection may mutate request-local polling state. Keep the
	// admission immutable while supplying the distributor with its own copy.
	selected, err := cloneLingtuChannel(admitted)
	if err != nil {
		return reject()
	}
	return selected, true, nil
}

// ChannelInfo implements SQL Scanner/Valuer: the generic native copier does
// not isolate its nested maps. Clone those maps explicitly using the standard
// library, retaining every native key status and polling field.
func cloneLingtuChannel(channel *model.Channel) (*model.Channel, error) {
	snapshot, err := common.DeepCopy(channel)
	if err != nil {
		return nil, err
	}
	snapshot.ChannelInfo = channel.ChannelInfo
	snapshot.ChannelInfo.MultiKeyStatusList = maps.Clone(channel.ChannelInfo.MultiKeyStatusList)
	snapshot.ChannelInfo.MultiKeyDisabledReason = maps.Clone(channel.ChannelInfo.MultiKeyDisabledReason)
	snapshot.ChannelInfo.MultiKeyDisabledTime = maps.Clone(channel.ChannelInfo.MultiKeyDisabledTime)
	return snapshot, nil
}
