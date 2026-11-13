package lingtuhost

import (
	"net"
	"net/url"
	"strings"
)

const visionModel = "qwen3-vl-plus"

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
			if !ok || !validImageURL(raw) {
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
	if selected == visionModel {
		_, err := selectedChannel(selected)
		supported = err == nil
	}
	return map[string]any{"vision": supported, "model": selected, "max_images": 4}
}
