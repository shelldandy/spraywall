package route

import "testing"

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
	}
	for _, tt := range tests {
		got, valid := validateCircuitName(tt.name)
		if got != tt.want || valid != tt.valid {
			t.Errorf("validateCircuitName(%q) = (%q, %v), want (%q, %v)", tt.name, got, valid, tt.want, tt.valid)
		}
	}
}
