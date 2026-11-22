package branding

import (
	"fmt"
	"math"
	"regexp"
	"strconv"
	"strings"
)

var hexColor = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)

// UsableAccent mirrors ADR-0045 and the frontend validator.
func UsableAccent(hex string) bool {
	if !hexColor.MatchString(hex) {
		return false
	}
	value := luminance(strings.ToLower(hex))
	return value >= 0.12 && value <= 0.3
}

func luminance(hex string) float64 {
	channel := func(offset int) float64 {
		value, _ := strconv.ParseInt(hex[offset:offset+2], 16, 64)
		normalized := float64(value) / 255
		if normalized <= 0.03928 {
			return normalized / 12.92
		}
		return math.Pow((normalized+0.055)/1.055, 2.4)
	}
	return 0.2126*channel(1) + 0.7152*channel(3) + 0.0722*channel(5)
}

const MaxAppName = 60
const MaxLogoBytes = 1 << 20
const MaxLogos = 5
const MaxAltText = 200

var allowedImageTypes = map[string]string{
	"image/png":     "image/png",
	"image/jpeg":    "image/jpeg",
	"image/webp":    "image/webp",
	"image/svg+xml": "image/svg+xml",
}

// NormalizeAppName validates a display name.
func NormalizeAppName(name string) (string, error) {
	trimmed := strings.TrimSpace(name)
	if trimmed == "" {
		return "", nil
	}
	if len(trimmed) > MaxAppName {
		return "", fmt.Errorf("app name must be at most %d characters", MaxAppName)
	}
	return trimmed, nil
}

// NormalizeAccent validates accent colours.
func NormalizeAccent(color string) (*string, error) {
	trimmed := strings.TrimSpace(color)
	if trimmed == "" {
		return nil, nil
	}
	lower := strings.ToLower(trimmed)
	if !UsableAccent(lower) {
		return nil, fmt.Errorf("accent colour must be a readable #rrggbb value")
	}
	return &lower, nil
}

// DetectImageType maps magic bytes to an allowed logo content type.
func DetectImageType(data []byte) (string, error) {
	switch {
	case len(data) >= 8 && data[0] == 0x89 && string(data[1:4]) == "PNG":
		return "image/png", nil
	case len(data) >= 3 && data[0] == 0xff && data[1] == 0xd8 && data[2] == 0xff:
		return "image/jpeg", nil
	case len(data) >= 12 && string(data[0:4]) == "RIFF" && string(data[8:12]) == "WEBP":
		return "image/webp", nil
	case len(data) >= 5 && strings.HasPrefix(strings.TrimSpace(string(data)), "<"):
		return "image/svg+xml", nil
	default:
		return "", fmt.Errorf("logo must be PNG, JPEG, WebP, or SVG")
	}
}

func NormalizeContentType(contentType string) (string, error) {
	normalized, ok := allowedImageTypes[strings.ToLower(strings.TrimSpace(contentType))]
	if !ok {
		return "", fmt.Errorf("unsupported image type")
	}
	return normalized, nil
}
