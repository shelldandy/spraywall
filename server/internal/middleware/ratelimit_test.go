package middleware

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func rateLimitRequest(handler http.Handler, remoteAddr, realIP string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.RemoteAddr = remoteAddr
	if realIP != "" {
		req.Header.Set("X-Real-IP", realIP)
	}
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, req)
	return response
}

func okHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})
}

func TestRateLimiterAllowsLimitAndRejectsNextRequest(t *testing.T) {
	handler := NewRateLimiter(2, time.Minute).Handler(okHandler())

	for i := 0; i < 2; i++ {
		if got := rateLimitRequest(handler, "192.0.2.1:1234", "").Code; got != http.StatusNoContent {
			t.Fatalf("request %d status = %d, want %d", i+1, got, http.StatusNoContent)
		}
	}

	response := rateLimitRequest(handler, "192.0.2.1:1234", "")
	if response.Code != http.StatusTooManyRequests {
		t.Fatalf("third request status = %d, want %d", response.Code, http.StatusTooManyRequests)
	}
	if got, want := strings.TrimSpace(response.Body.String()), `{"error":"rate limit exceeded"}`; got != want {
		t.Fatalf("response body = %q, want %q", got, want)
	}
	if got := response.Header().Get("Content-Type"); got != "application/json" {
		t.Fatalf("Content-Type = %q, want application/json", got)
	}
}

func TestRateLimiterUsesXRealIP(t *testing.T) {
	handler := NewRateLimiter(1, time.Minute).Handler(okHandler())

	first := rateLimitRequest(handler, "192.0.2.1:1234", "198.51.100.1")
	if first.Code != http.StatusNoContent {
		t.Fatalf("first request status = %d, want %d", first.Code, http.StatusNoContent)
	}

	// A different RemoteAddr with the same X-Real-IP shares the first counter.
	second := rateLimitRequest(handler, "192.0.2.2:1234", "198.51.100.1")
	if second.Code != http.StatusTooManyRequests {
		t.Fatalf("second request status = %d, want %d", second.Code, http.StatusTooManyRequests)
	}

	// The same RemoteAddr with another X-Real-IP gets a separate counter.
	third := rateLimitRequest(handler, "192.0.2.2:1234", "198.51.100.2")
	if third.Code != http.StatusNoContent {
		t.Fatalf("third request status = %d, want %d", third.Code, http.StatusNoContent)
	}
}

func TestRateLimiterSeparatesIPs(t *testing.T) {
	handler := NewRateLimiter(1, time.Minute).Handler(okHandler())

	for _, ip := range []string{"192.0.2.1:1234", "192.0.2.2:1234"} {
		if got := rateLimitRequest(handler, ip, "").Code; got != http.StatusNoContent {
			t.Errorf("request from %s status = %d, want %d", ip, got, http.StatusNoContent)
		}
	}
}

func TestRateLimiterResetsAfterWindow(t *testing.T) {
	handler := NewRateLimiter(1, 50*time.Millisecond).Handler(okHandler())
	remoteAddr := "192.0.2.1:1234"

	if got := rateLimitRequest(handler, remoteAddr, "").Code; got != http.StatusNoContent {
		t.Fatalf("first request status = %d, want %d", got, http.StatusNoContent)
	}
	time.Sleep(75 * time.Millisecond)
	if got := rateLimitRequest(handler, remoteAddr, "").Code; got != http.StatusNoContent {
		t.Fatalf("request after window status = %d, want %d", got, http.StatusNoContent)
	}
}
