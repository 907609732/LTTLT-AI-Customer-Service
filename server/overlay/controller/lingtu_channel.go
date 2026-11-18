package controller

import (
	"bytes"
	"context"
	"encoding/base64"
	"errors"
	"image"
	"image/color"
	"image/png"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relaykit/dto"
)

// The image probe deliberately uses a server-generated synthetic picture and
// an answer that is not present in the prompt. A non-empty or merely successful
// provider response is not enough to mark a channel as image-capable.
const managedVisionProbePrompt = "What are the two solid horizontal band colors in this image? Reply exactly with the top color, then a comma, then the bottom color. Do not explain."

type managedImageTestRequestKey struct{}

func managedVisionProbeImage() string {
	picture := image.NewRGBA(image.Rect(0, 0, 64, 64))
	red := color.RGBA{R: 0xff, A: 0xff}
	blue := color.RGBA{B: 0xff, A: 0xff}
	for y := range 64 {
		for x := range 64 {
			if y < 32 {
				picture.SetRGBA(x, y, red)
			} else {
				picture.SetRGBA(x, y, blue)
			}
		}
	}
	var encoded bytes.Buffer
	_ = png.Encode(&encoded, picture)
	return "data:image/png;base64," + base64.StdEncoding.EncodeToString(encoded.Bytes())
}

func managedVisionProbeAccepted(raw []byte) bool {
	var response struct {
		Choices []struct {
			Message struct {
				Content any `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if common.Unmarshal(raw, &response) != nil || len(response.Choices) == 0 {
		return false
	}
	content, ok := response.Choices[0].Message.Content.(string)
	if !ok {
		return false
	}
	text := strings.ToLower(content)
	text = strings.NewReplacer(",", " ", ".", " ", "!", " ", "\n", " ", "\t", " ").Replace(text)
	parts := strings.Fields(text)
	return len(parts) == 2 && parts[0] == "red" && parts[1] == "blue"
}

// TestManagedImageChannel reuses the native relay adapter and channel test
// plumbing, but injects a fixed multimodal message through the prepared source
// patch. It intentionally returns only success/failure to the admin layer.
func TestManagedImageChannel(ctx context.Context, channel *model.Channel, userID int) error {
	messages := []dto.Message{{
		Role: "user",
		Content: []any{
			map[string]any{"type": "text", "text": managedVisionProbePrompt},
			map[string]any{"type": "image_url", "image_url": map[string]any{"url": managedVisionProbeImage()}},
		},
	}}
	ctx = context.WithValue(ctx, managedImageTestRequestKey{}, messages)
	result := testChannel(ctx, channel, userID, channel.Models, string(constant.EndpointTypeOpenAI), false)
	if result.localErr != nil || result.newAPIError != nil {
		return errors.New("managed image connection test failed")
	}
	if !managedVisionProbeAccepted(result.responseBody) {
		return errors.New("managed image connection test did not return the fixed answer")
	}
	return nil
}

// Reuse the upstream adapter and protocol test rather than a second HTTP model client.
func TestManagedChannel(ctx context.Context, channel *model.Channel, userID int) error {
	result := testChannel(ctx, channel, userID, channel.Models, string(constant.EndpointTypeOpenAI), false)
	if result.localErr != nil || result.newAPIError != nil {
		return errors.New("managed model connection test failed")
	}
	return nil
}
