package controller

import (
	"context"
	"errors"

	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
)

// Reuse the upstream adapter and protocol test rather than a second HTTP model client.
func TestManagedChannel(ctx context.Context, channel *model.Channel, userID int) error {
	result := testChannel(ctx, channel, userID, channel.Models, string(constant.EndpointTypeOpenAI), false)
	if result.localErr != nil || result.newAPIError != nil {
		return errors.New("managed model connection test failed")
	}
	return nil
}
