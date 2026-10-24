package wall

import "testing"

func TestIsValidWallImageMode(t *testing.T) {
	for _, mode := range []string{"", "full", "partial"} {
		if !isValidWallImageMode(mode) {
			t.Errorf("mode %q rejected", mode)
		}
	}
	if isValidWallImageMode("unknown") {
		t.Error("unknown mode accepted")
	}
}
