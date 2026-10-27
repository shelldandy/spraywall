package route

import "testing"

func TestParseBetaVideoURL(t *testing.T) {
	const youtubeID = "dQw4w9WgXcQ"
	tests := []struct {
		name       string
		url        string
		allowed    []string
		source     string
		externalID string
		normalized string
		wantErr    error
	}{
		{"youtube watch", "https://youtube.com/watch?v=" + youtubeID + "&feature=share", nil, "youtube", youtubeID, "https://www.youtube.com/watch?v=" + youtubeID, nil},
		{"youtube short link", "https://youtu.be/" + youtubeID, nil, "youtube", youtubeID, "https://www.youtube.com/watch?v=" + youtubeID, nil},
		{"youtube shorts", "https://www.youtube.com/shorts/" + youtubeID, nil, "youtube", youtubeID, "https://www.youtube.com/watch?v=" + youtubeID, nil},
		{"instagram reel", "https://www.instagram.com/reel/CxYz_123/", nil, "instagram", "CxYz_123", "https://www.instagram.com/reel/CxYz_123/", nil},
		{"instagram post", "https://instagram.com/p/ABC123", nil, "instagram", "ABC123", "https://www.instagram.com/p/ABC123/", nil},
		{"tiktok video", "https://www.tiktok.com/@climber/video/1234567890123456789", nil, "tiktok", "1234567890123456789", "https://www.tiktok.com/@climber/video/1234567890123456789", nil},
		{"tiktok short URL", "https://vm.tiktok.com/ZMabc123/", nil, "tiktok", "ZMabc123", "https://vm.tiktok.com/ZMabc123", nil},
		{"Immich share key", "https://photos.example.net/share/Abc_123", []string{"photos.example.net"}, "immich", "", "https://photos.example.net/share/Abc_123", nil},
		{"Immich slug", "https://photos.example.net/s/slug-123", []string{"photos.example.net"}, "immich", "", "https://photos.example.net/s/slug-123", nil},
		{"junk", "https://example.org/not-a-video", nil, "", "", "", nil},
		{"bad YouTube ID", "https://youtube.com/watch?v=short", nil, "", "", "", nil},
		{"disallowed Immich host", "https://other.example.net/share/key", []string{"photos.example.net"}, "", "", "", errImmichHostNotAllowed},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			source, externalID, normalized, ref, err := parseBetaVideoURL(tt.url, tt.allowed...)
			if tt.wantErr != nil {
				if err != tt.wantErr {
					t.Fatalf("error = %v, want %v", err, tt.wantErr)
				}
				return
			}
			if tt.source == "" {
				if err == nil {
					t.Fatalf("expected invalid URL, got source=%q normalized=%q", source, normalized)
				}
				return
			}
			if err != nil {
				t.Fatalf("parse URL: %v", err)
			}
			if source != tt.source || normalized != tt.normalized {
				t.Fatalf("got source=%q normalized=%q, want source=%q normalized=%q", source, normalized, tt.source, tt.normalized)
			}
			if tt.externalID == "" {
				if externalID != nil {
					t.Fatalf("external ID = %q, want nil", *externalID)
				}
			} else if externalID == nil || *externalID != tt.externalID {
				t.Fatalf("external ID = %v, want %q", externalID, tt.externalID)
			}
			if source == "immich" && ref == nil {
				t.Fatal("Immich reference is nil")
			}
		})
	}
}
