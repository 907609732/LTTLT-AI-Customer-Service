package controller

import (
	"bytes"
	"encoding/base64"
	"image/color"
	"image/png"
	"strings"
	"testing"
)

func TestManagedVisionProbeImageHasCheckableFixedColors(t *testing.T) {
	raw := managedVisionProbeImage()
	const prefix = "data:image/png;base64,"
	if !strings.HasPrefix(raw, prefix) {
		t.Fatal("probe is not a PNG data URL")
	}
	decoded, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(raw, prefix))
	if err != nil {
		t.Fatal(err)
	}
	picture, err := png.Decode(bytes.NewReader(decoded))
	if err != nil {
		t.Fatal(err)
	}
	bounds := picture.Bounds()
	if bounds.Dx() < 32 || bounds.Dy() < 32 {
		t.Fatal("probe image is too small to test visual grounding")
	}
	red := picture.At(bounds.Min.X+bounds.Dx()/2, bounds.Min.Y+bounds.Dy()/4)
	blue := picture.At(bounds.Min.X+bounds.Dx()/2, bounds.Min.Y+bounds.Dy()*3/4)
	if red != (color.RGBA{R: 0xff, A: 0xff}) || blue != (color.RGBA{B: 0xff, A: 0xff}) {
		t.Fatalf("probe colors = top:%v bottom:%v", red, blue)
	}
	if strings.Contains(strings.ToLower(managedVisionProbePrompt), "red") || strings.Contains(strings.ToLower(managedVisionProbePrompt), "blue") {
		t.Fatal("probe prompt leaks the expected answer")
	}
}

func TestManagedVisionProbeRequiresTheFixedAnswer(t *testing.T) {
	if !managedVisionProbeAccepted([]byte(`{"choices":[{"message":{"content":"Red, blue."}}]}`)) {
		t.Fatal("valid fixed answer rejected")
	}
	for _, wrong := range []string{
		`{"choices":[{"message":{"content":"blue, red"}}]}`,
		`{"choices":[{"message":{"content":"red"}}]}`,
		`{"choices":[{"message":{"content":"I cannot determine the colors"}}]}`,
		`{"choices":[]}`,
		`{}`,
	} {
		if managedVisionProbeAccepted([]byte(wrong)) {
			t.Fatalf("wrong probe answer accepted: %s", wrong)
		}
	}
}
