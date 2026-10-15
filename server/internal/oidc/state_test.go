package oidc

import (
	"encoding/json"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/bowlinedandy/spraywall/server/db/generated"
)

func TestSanitizeRedirect(t *testing.T) {
	cases := map[string]string{
		"":                       "/walls",
		"/":                      "/",
		"/invite/abc123":         "/invite/abc123",
		"/gyms/x?tab=routes#top": "/gyms/x?tab=routes#top",
		"//evil.example.com":     "/walls",
		"/\\evil.example.com":    "/walls",
		"https://evil.example":   "/walls",
		"walls":                  "/walls",
		"javascript:alert(1)":    "/walls",
		"/ok\r\nSet-Cookie: x=y": "/walls",
	}
	for in, want := range cases {
		if got := sanitizeRedirect(in); got != want {
			t.Errorf("sanitizeRedirect(%q) = %q, want %q", in, got, want)
		}
	}
}

func testState(now time.Time) flowState {
	return flowState{
		State:    "state-value",
		Nonce:    "nonce-value",
		Verifier: "verifier-value",
		Redirect: "/invite/abc",
		Mode:     modeLink,
		UserID:   "6b9f3c1e-0000-4000-8000-000000000001",
		Expires:  now.Add(stateTTL).Unix(),
	}
}

func TestStateRoundTrip(t *testing.T) {
	key := deriveStateKey("jwt-secret")
	now := time.Now()
	want := testState(now)

	value, err := encodeState(key, want)
	if err != nil {
		t.Fatal(err)
	}
	got, err := decodeState(key, value, now.Add(stateTTL-time.Second))
	if err != nil {
		t.Fatalf("decodeState: %v", err)
	}
	if got != want {
		t.Fatalf("round trip mismatch: got %+v want %+v", got, want)
	}
}

func TestStateRejectsExpired(t *testing.T) {
	key := deriveStateKey("jwt-secret")
	now := time.Now()
	value, err := encodeState(key, testState(now))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := decodeState(key, value, now.Add(stateTTL+2*time.Second)); err == nil {
		t.Fatal("expected expired state to be rejected")
	}
}

func TestStateRejectsTampering(t *testing.T) {
	key := deriveStateKey("jwt-secret")
	now := time.Now()
	value, err := encodeState(key, testState(now))
	if err != nil {
		t.Fatal(err)
	}

	// Wrong key (e.g. different JWT_SECRET) must fail.
	if _, err := decodeState(deriveStateKey("other-secret"), value, now); err == nil {
		t.Fatal("expected state signed with another key to be rejected")
	}

	// A re-encoded payload with a modified user id keeps the old MAC.
	payload, sig, _ := strings.Cut(value, ".")
	forged := testState(now)
	forged.UserID = "6b9f3c1e-0000-4000-8000-000000000002"
	forgedValue, err := encodeState([]byte("attacker-key"), forged)
	if err != nil {
		t.Fatal(err)
	}
	forgedPayload, _, _ := strings.Cut(forgedValue, ".")
	if _, err := decodeState(key, forgedPayload+"."+sig, now); err == nil {
		t.Fatal("expected payload with mismatched MAC to be rejected")
	}

	for _, bad := range []string{"", "no-dot", payload + ".", "." + sig, payload + ".!!!"} {
		if _, err := decodeState(key, bad, now); err == nil {
			t.Errorf("expected malformed value %q to be rejected", bad)
		}
	}
}

func TestStateKeyIsNotJWTSecret(t *testing.T) {
	if string(deriveStateKey("jwt-secret")) == "jwt-secret" {
		t.Fatal("state key must be derived, not the raw JWT secret")
	}
}

func TestParseGroups(t *testing.T) {
	cases := []struct {
		in     any
		want   []string
		wantOK bool
	}{
		{[]any{"a", "b", 3}, []string{"a", "b"}, true},
		{[]string{"x"}, []string{"x"}, true},
		{"admins", []string{"admins"}, true},
		{"", []string{}, true},
		{nil, nil, false},
		{42, nil, false},
	}
	for _, c := range cases {
		got, ok := parseGroups(c.in)
		if ok != c.wantOK || !reflect.DeepEqual(got, c.want) {
			t.Errorf("parseGroups(%#v) = %#v, %v; want %#v, %v", c.in, got, ok, c.want, c.wantOK)
		}
	}
}

func TestParseBoolClaim(t *testing.T) {
	cases := map[any]bool{
		true: true, false: false, "true": true, "TRUE": true, "false": false, "": false, 1: false,
	}
	for in, want := range cases {
		if got := parseBoolClaim(in); got != want {
			t.Errorf("parseBoolClaim(%#v) = %v, want %v", in, got, want)
		}
	}
	if parseBoolClaim(nil) {
		t.Error("parseBoolClaim(nil) should be false")
	}
}

func TestRoleForGroups(t *testing.T) {
	if got := roleForGroups([]string{"users", "spraywall-admins"}, "spraywall-admins"); got != generated.UserRoleAdmin {
		t.Errorf("member of admin group got %s", got)
	}
	if got := roleForGroups([]string{"users"}, "spraywall-admins"); got != generated.UserRoleClimber {
		t.Errorf("non-member got %s", got)
	}
	if got := roleForGroups(nil, "spraywall-admins"); got != generated.UserRoleClimber {
		t.Errorf("no groups got %s", got)
	}
}

func TestClaimsParsingAndDisplayName(t *testing.T) {
	var raw map[string]any
	if err := json.Unmarshal([]byte(`{
		"email": "ada@example.com", "email_verified": "true",
		"preferred_username": "ada", "roles": "admins"
	}`), &raw); err != nil {
		t.Fatal(err)
	}
	c := parseClaims(raw, "roles")
	if !c.hasEmail || !c.EmailVerified || c.Email != "ada@example.com" {
		t.Fatalf("unexpected email claims: %+v", c)
	}
	if !c.hasGroups || !reflect.DeepEqual(c.Groups, []string{"admins"}) {
		t.Fatalf("unexpected groups: %+v", c.Groups)
	}
	if got := c.displayName(); got != "ada" {
		t.Errorf("displayName = %q, want preferred_username", got)
	}

	// UserInfo fills in only what is missing.
	c.merge(map[string]any{"name": "Ada Lovelace", "email": "other@example.com", "roles": []any{"x"}}, "roles")
	if c.Email != "ada@example.com" || !reflect.DeepEqual(c.Groups, []string{"admins"}) {
		t.Fatalf("merge overwrote existing claims: %+v", c)
	}
	if got := c.displayName(); got != "Ada Lovelace" {
		t.Errorf("displayName = %q, want name", got)
	}

	if got := (identityClaims{Email: "bob@example.com"}).displayName(); got != "bob" {
		t.Errorf("displayName fallback = %q, want email local part", got)
	}
}

func TestParseScopes(t *testing.T) {
	cases := map[string][]string{
		"":                        {"openid", "email", "profile", "groups"},
		"openid,email":            {"openid", "email"},
		"email profile":           {"openid", "email", "profile"},
		" openid , email,groups ": {"openid", "email", "groups"},
	}
	for in, want := range cases {
		if got := parseScopes(in); !reflect.DeepEqual(got, want) {
			t.Errorf("parseScopes(%q) = %v, want %v", in, got, want)
		}
	}
}

func TestLoadConfig(t *testing.T) {
	for _, k := range []string{"OIDC_ISSUER_URL", "OIDC_CLIENT_ID", "OIDC_CLIENT_SECRET", "OIDC_REDIRECT_URL",
		"OIDC_PROVIDER_NAME", "OIDC_SCOPES", "OIDC_GROUPS_CLAIM", "OIDC_ADMIN_GROUP"} {
		t.Setenv(k, "")
	}

	cfg, err := LoadConfig()
	if err != nil || cfg.Enabled {
		t.Fatalf("expected disabled config without issuer, got %+v, %v", cfg, err)
	}
	if cfg.ProviderName != "SSO" || cfg.GroupsClaim != "groups" {
		t.Fatalf("unexpected defaults: %+v", cfg)
	}

	t.Setenv("OIDC_ISSUER_URL", "https://id.example.com")
	t.Setenv("OIDC_CLIENT_ID", "client")
	if _, err := LoadConfig(); err == nil || !strings.Contains(err.Error(), "OIDC_CLIENT_SECRET") {
		t.Fatalf("expected missing secret error, got %v", err)
	}

	t.Setenv("OIDC_CLIENT_SECRET", "secret")
	t.Setenv("OIDC_REDIRECT_URL", "https://spraywall.example.com/api/auth/oidc/callback")
	t.Setenv("OIDC_PROVIDER_NAME", "Pocket-ID")
	cfg, err = LoadConfig()
	if err != nil || !cfg.Enabled || cfg.ProviderName != "Pocket-ID" {
		t.Fatalf("unexpected config %+v, %v", cfg, err)
	}
}

func TestPasswordLoginEnabled(t *testing.T) {
	for in, want := range map[string]bool{"": true, "true": true, "false": false, "0": false} {
		t.Setenv("PASSWORD_LOGIN_ENABLED", in)
		got, err := PasswordLoginEnabled()
		if err != nil || got != want {
			t.Errorf("PASSWORD_LOGIN_ENABLED=%q: got %v, %v", in, got, err)
		}
	}
	t.Setenv("PASSWORD_LOGIN_ENABLED", "maybe")
	if _, err := PasswordLoginEnabled(); err == nil {
		t.Error("expected invalid value to error")
	}
}

func TestConfigHandler(t *testing.T) {
	rec := httptest.NewRecorder()
	ConfigHandler(false, Config{Enabled: true, ProviderName: "Pocket-ID"})(rec, httptest.NewRequest("GET", "/auth/config", nil))
	want := `{"password_enabled":false,"oidc":{"enabled":true,"name":"Pocket-ID"}}`
	if got := strings.TrimSpace(rec.Body.String()); got != want {
		t.Fatalf("body = %s, want %s", got, want)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/json" {
		t.Fatalf("content type = %q", ct)
	}
}
