// Package oidc implements single sign-on through an OpenID Connect provider
// (e.g. Pocket-ID), plus linking provider identities to existing accounts.
package oidc

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"slices"
	"strconv"
	"strings"
)

const (
	defaultProviderName = "SSO"
	defaultScopes       = "openid email profile groups"
	defaultGroupsClaim  = "groups"
)

// Config holds OIDC settings loaded from the environment. OIDC is disabled
// unless OIDC_ISSUER_URL is set.
type Config struct {
	Enabled      bool
	IssuerURL    string
	ClientID     string
	ClientSecret string
	RedirectURL  string
	ProviderName string
	Scopes       []string
	GroupsClaim  string
	// AdminGroup, when set, makes members of the group instance admins and
	// demotes everyone else to climber on each OIDC login.
	AdminGroup string
}

// LoadConfig reads OIDC_* environment variables. It returns an error when
// OIDC is enabled but required settings are missing.
func LoadConfig() (Config, error) {
	cfg := Config{
		IssuerURL:    strings.TrimSpace(os.Getenv("OIDC_ISSUER_URL")),
		ClientID:     strings.TrimSpace(os.Getenv("OIDC_CLIENT_ID")),
		ClientSecret: os.Getenv("OIDC_CLIENT_SECRET"),
		RedirectURL:  strings.TrimSpace(os.Getenv("OIDC_REDIRECT_URL")),
		ProviderName: strings.TrimSpace(os.Getenv("OIDC_PROVIDER_NAME")),
		Scopes:       parseScopes(os.Getenv("OIDC_SCOPES")),
		GroupsClaim:  strings.TrimSpace(os.Getenv("OIDC_GROUPS_CLAIM")),
		AdminGroup:   strings.TrimSpace(os.Getenv("OIDC_ADMIN_GROUP")),
	}
	cfg.Enabled = cfg.IssuerURL != ""
	if cfg.ProviderName == "" {
		cfg.ProviderName = defaultProviderName
	}
	if cfg.GroupsClaim == "" {
		cfg.GroupsClaim = defaultGroupsClaim
	}
	if !cfg.Enabled {
		return cfg, nil
	}

	var missing []string
	if cfg.ClientID == "" {
		missing = append(missing, "OIDC_CLIENT_ID")
	}
	if cfg.ClientSecret == "" {
		missing = append(missing, "OIDC_CLIENT_SECRET")
	}
	if cfg.RedirectURL == "" {
		missing = append(missing, "OIDC_REDIRECT_URL")
	}
	if len(missing) > 0 {
		return cfg, fmt.Errorf("OIDC_ISSUER_URL is set but %s missing", strings.Join(missing, ", "))
	}
	return cfg, nil
}

// parseScopes splits a space- or comma-separated scope list, always
// including "openid".
func parseScopes(raw string) []string {
	if strings.TrimSpace(raw) == "" {
		raw = defaultScopes
	}
	scopes := strings.FieldsFunc(raw, func(r rune) bool {
		return r == ',' || r == ' ' || r == '\t' || r == '\n'
	})
	if !slices.Contains(scopes, "openid") {
		scopes = append([]string{"openid"}, scopes...)
	}
	return scopes
}

// PasswordLoginEnabled reads PASSWORD_LOGIN_ENABLED (default true).
func PasswordLoginEnabled() (bool, error) {
	raw := strings.TrimSpace(os.Getenv("PASSWORD_LOGIN_ENABLED"))
	if raw == "" {
		return true, nil
	}
	enabled, err := strconv.ParseBool(raw)
	if err != nil {
		return false, fmt.Errorf("invalid PASSWORD_LOGIN_ENABLED %q: %w", raw, err)
	}
	return enabled, nil
}

// ConfigHandler serves GET /auth/config so the SPA can render the right
// login options.
func ConfigHandler(passwordEnabled bool, cfg Config) http.HandlerFunc {
	type oidcInfo struct {
		Enabled bool   `json:"enabled"`
		Name    string `json:"name"`
	}
	body, _ := json.Marshal(struct {
		PasswordEnabled bool     `json:"password_enabled"`
		OIDC            oidcInfo `json:"oidc"`
	}{
		PasswordEnabled: passwordEnabled,
		OIDC:            oidcInfo{Enabled: cfg.Enabled, Name: cfg.ProviderName},
	})
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write(body) //nolint:errcheck
	}
}
