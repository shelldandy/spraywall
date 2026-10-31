package route

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestImmichMediaStreamingHasNoTotalRequestTimeout(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = io.WriteString(w, "a")
		w.(http.Flusher).Flush()
		time.Sleep(50 * time.Millisecond)
		_, _ = io.WriteString(w, "b")
	}))
	defer server.Close()

	client := NewImmichClient([]string{strings.TrimPrefix(server.URL, "http://")})
	client.httpClient.Timeout = 10 * time.Millisecond
	response, err := client.mediaRequest(t.Context(), server.URL, "/video", "", "", make(http.Header))
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	body, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatal(err)
	}
	if string(body) != "ab" {
		t.Fatalf("stream body = %q, want ab", body)
	}
}
