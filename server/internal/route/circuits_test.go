package route

import (
	"strings"
	"testing"
)

func TestValidateCircuitStyle(t *testing.T) {
	tests := []struct {
		color, emoji, wantColor, wantEmoji string
		valid                              bool
	}{
		{"", "", defaultCircuitColor, defaultCircuitEmoji, true},
		{"violet", "🔥", "violet", "🔥", true},
		{"ink", "🐢", "ink", "🐢", true},
		{"purple", "🔥", "purple", "🔥", false},
		{"blue", "😀", "blue", "😀", false},
	}
	for _, tt := range tests {
		color, emoji, valid := validateCircuitStyle(tt.color, tt.emoji)
		if color != tt.wantColor || emoji != tt.wantEmoji || valid != tt.valid {
			t.Errorf("validateCircuitStyle(%q, %q) = (%q, %q, %v), want (%q, %q, %v)", tt.color, tt.emoji, color, emoji, valid, tt.wantColor, tt.wantEmoji, tt.valid)
		}
	}
}

func TestValidateCircuitName(t *testing.T) {
	tests := []struct {
		name, want string
		valid      bool
	}{
		{"  Warm up  ", "Warm up", true},
		{"", "", false},
		{"   ", "", false},
		{string(make([]byte, 61)), string(make([]byte, 61)), false},
		{string(make([]byte, 60)), string(make([]byte, 60)), true},
		{strings.Repeat("é", 60), strings.Repeat("é", 60), true},
		{strings.Repeat("é", 61), strings.Repeat("é", 61), false},
	}
	for _, tt := range tests {
		got, valid := validateCircuitName(tt.name)
		if got != tt.want || valid != tt.valid {
			t.Errorf("validateCircuitName(%q) = (%q, %v), want (%q, %v)", tt.name, got, valid, tt.want, tt.valid)
		}
	}
}
