package lingtuhost

import (
	"bytes"
	"encoding/base64"
	"image/png"
	"net"
	"net/url"
	"strings"
)

const visionModel = "qwen3-vl-plus"

// Local knowledge tiles are bounded pixels, not fetchable URLs or arbitrary file uploads.
func validModelImage(raw string) bool {
	const prefix = "data:image/png;base64,"
	if !strings.HasPrefix(raw, prefix) {
		return validImageURL(raw)
	}
	encoded := strings.TrimPrefix(raw, prefix)
	if len(encoded) == 0 || len(encoded) > 12*1024*1024 {
		return false
	}
	data, err := base64.StdEncoding.Strict().DecodeString(encoded)
	if err != nil || len(data) > 8*1024*1024 || base64.StdEncoding.EncodeToString(data) != encoded {
		return false
	}
	config, err := png.DecodeConfig(bytes.NewReader(data))
	if err != nil || config.Width < 1 || config.Height < 1 || config.Width > 1400 || config.Height > 1400 {
		return false
	}
	_, err = png.Decode(bytes.NewReader(data))
	return err == nil
}

func validImageURL(raw string) bool {
	if len(raw) == 0 || len(raw) > 2048 || strings.TrimSpace(raw) != raw || !strings.HasPrefix(raw, "https://") {
		return false
	}
	u, err := url.Parse(raw)
	if err != nil {
		return false
	}
	host := strings.ToLower(u.Hostname())
	if u.Scheme != "https" || u.User != nil || u.Fragment != "" || (u.Port() != "" && u.Port() != "443") || net.ParseIP(host) != nil || !strings.Contains(host, ".") || strings.HasSuffix(host, ".") {
		return false
	}
	// Also reject URL parsers' alternate numeric IPv4 spellings (127.1, 0x7f000001).
	if strings.HasPrefix(host, "0x") {
		return false
	}
	numeric := true
	for _, r := range host {
		if (r < '0' || r > '9') && r != '.' {
			numeric = false
			break
		}
	}
	if numeric {
		return false
	}
	for _, suffix := range []string{"localhost", "local", "internal", "lan", "home", "invalid"} {
		if host == suffix || strings.HasSuffix(host, "."+suffix) {
			return false
		}
	}
	return true
}
func validChatContent(role string, content any, images *int) bool {
	if text, ok := content.(string); ok {
		return len(text) > 0 && len(text) <= 32768
	}
	parts, ok := content.([]any)
	if !ok || role != "user" || len(parts) < 1 || len(parts) > 8 {
		return false
	}
	for _, part := range parts {
		p, ok := part.(map[string]any)
		if !ok || len(p) != 2 {
			return false
		}
		switch p["type"] {
		case "text":
			s, ok := p["text"].(string)
			if !ok || len(s) < 1 || len(s) > 32768 {
				return false
			}
		case "image_url":
			image, ok := p["image_url"].(map[string]any)
			if !ok || len(image) != 1 {
				return false
			}
			raw, ok := image["url"].(string)
			if !ok || !validModelImage(raw) {
				return false
			}
			*images++
			if *images > 4 {
				return false
			}
		default:
			return false
		}
	}
	return true
}
func containsImages(messages []chatMessage) bool {
	for _, m := range messages {
		if parts, ok := m.Content.([]any); ok {
			for _, v := range parts {
				if p, ok := v.(map[string]any); ok && p["type"] == "image_url" {
					return true
				}
			}
		}
	}
	return false
}

func visionCapability(selected string) map[string]any {
	supported := false
	if channel, err := selectedChannel(selected); err == nil {
		// Configured API connections use stable aliases; inspect the admitted upstream model.
		supported = channel.Models == visionModel
	}
	return map[string]any{"vision": supported, "model": selected, "max_images": 4}
}
