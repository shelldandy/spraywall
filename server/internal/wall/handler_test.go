package wall

import (
	"bytes"
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func installFakeMagick(t *testing.T, dimensions string) string {
	t.Helper()

	dir := t.TempDir()
	magickPath := filepath.Join(dir, "magick")
	script := `#!/bin/sh
if [ "$1" = "identify" ]; then
  cat >/dev/null
  printf '%s' "$FAKE_MAGICK_DIMENSIONS"
  exit 0
fi
cat >/dev/null
printf '%s' "$*" > "$FAKE_MAGICK_CONVERT_ARGS"
printf 'jpeg-data'
`
	if err := os.WriteFile(magickPath, []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}

	argsPath := filepath.Join(dir, "convert-args")
	t.Setenv("PATH", dir+string(os.PathListSeparator)+os.Getenv("PATH"))
	t.Setenv("FAKE_MAGICK_DIMENSIONS", dimensions)
	t.Setenv("FAKE_MAGICK_CONVERT_ARGS", argsPath)
	return argsPath
}

func TestConvertHEICToJPEGRejectsOversizedImageBeforeDecode(t *testing.T) {
	convertArgsPath := installFakeMagick(t, "8001 8000")

	_, err := convertHEICToJPEG(context.Background(), bytes.NewReader([]byte("fake HEIC")))
	if err == nil || !strings.Contains(err.Error(), "exceed the 64000000-pixel limit") {
		t.Fatalf("expected oversized image rejection, got %v", err)
	}
	if _, err := os.Stat(convertArgsPath); !os.IsNotExist(err) {
		t.Fatalf("full conversion ran for an oversized image (stat error: %v)", err)
	}
}

func TestConvertHEICToJPEGAllowsImageAtPixelLimit(t *testing.T) {
	convertArgsPath := installFakeMagick(t, "8000 8000")

	jpeg, err := convertHEICToJPEG(context.Background(), bytes.NewReader([]byte("fake HEIC")))
	if err != nil {
		t.Fatalf("convertHEICToJPEG returned error: %v", err)
	}
	if string(jpeg) != "jpeg-data" {
		t.Fatalf("unexpected converted bytes: %q", jpeg)
	}
	args, err := os.ReadFile(convertArgsPath)
	if err != nil {
		t.Fatalf("full conversion did not run: %v", err)
	}
	if !strings.Contains(string(args), "-limit area 64000000") {
		t.Fatalf("conversion missing ImageMagick resource limits: %s", args)
	}
}

func TestConvertHEICToJPEGWithImageMagick(t *testing.T) {
	magick, err := exec.LookPath("magick")
	if err != nil {
		t.Skip("ImageMagick is not installed")
	}

	inputPath := filepath.Join(t.TempDir(), "small.heic")
	generate := exec.Command(magick, "-size", "2x3", "xc:red", inputPath)
	if output, err := generate.CombinedOutput(); err != nil {
		t.Skipf("ImageMagick HEIC encoder is unavailable: %v: %s", err, output)
	}
	input, err := os.ReadFile(inputPath)
	if err != nil {
		t.Fatal(err)
	}

	jpeg, err := convertHEICToJPEG(context.Background(), bytes.NewReader(input))
	if err != nil {
		t.Fatalf("convertHEICToJPEG failed on a small HEIC: %v", err)
	}
	if len(jpeg) < 2 || jpeg[0] != 0xff || jpeg[1] != 0xd8 {
		t.Fatalf("conversion did not produce JPEG data")
	}
}
