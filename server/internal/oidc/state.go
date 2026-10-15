package oidc

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"time"
)

const (
	stateCookieName = "spraywall_oidc_state"
	stateTTL        = 10 * time.Minute

	modeLogin = "login"
	modeLink  = "link"

	defaultRedirect = "/walls"
)

var errInvalidState = errors.New("invalid oidc state cookie")

// flowState is carried across the IdP round trip in a signed cookie.
type flowState struct {
	State    string `json:"s"`
	Nonce    string `json:"n"`
	Verifier string `json:"v"`
	Redirect string `json:"r,omitempty"`
	Mode     string `json:"m"`
	UserID   string `json:"u,omitempty"`
	Expires  int64  `json:"e"`
}

// deriveStateKey derives the cookie signing key from the JWT secret so the
// two never share a key directly.
func deriveStateKey(jwtSecret string) []byte {
	mac := hmac.New(sha256.New, []byte(jwtSecret))
	mac.Write([]byte("oidc-state"))
	return mac.Sum(nil)
}

func randomToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

// encodeState serializes and signs the state as "<payload>.<mac>".
func encodeState(key []byte, st flowState) (string, error) {
	payload, err := json.Marshal(st)
	if err != nil {
		return "", err
	}
	p := base64.RawURLEncoding.EncodeToString(payload)
	return p + "." + base64.RawURLEncoding.EncodeToString(signState(key, p)), nil
}

func signState(key []byte, payload string) []byte {
	mac := hmac.New(sha256.New, key)
	mac.Write([]byte(payload))
	return mac.Sum(nil)
}

// decodeState verifies the signature and expiry of a cookie value.
func decodeState(key []byte, value string, now time.Time) (flowState, error) {
	p, sig, ok := strings.Cut(value, ".")
	if !ok {
		return flowState{}, errInvalidState
	}
	gotMAC, err := base64.RawURLEncoding.DecodeString(sig)
	if err != nil || !hmac.Equal(gotMAC, signState(key, p)) {
		return flowState{}, errInvalidState
	}
	payload, err := base64.RawURLEncoding.DecodeString(p)
	if err != nil {
		return flowState{}, errInvalidState
	}
	var st flowState
	if err := json.Unmarshal(payload, &st); err != nil {
		return flowState{}, errInvalidState
	}
	if now.Unix() > st.Expires || st.State == "" || st.Nonce == "" || st.Verifier == "" {
		return flowState{}, errInvalidState
	}
	if st.Mode != modeLogin && st.Mode != modeLink {
		return flowState{}, errInvalidState
	}
	return st, nil
}

// sanitizeRedirect only allows same-origin absolute paths, defaulting to
// /walls. Protocol-relative ("//host") and backslash ("/\host") forms are
// rejected because browsers treat them as off-site URLs.
func sanitizeRedirect(raw string) string {
	if !strings.HasPrefix(raw, "/") || strings.HasPrefix(raw, "//") || strings.HasPrefix(raw, "/\\") {
		return defaultRedirect
	}
	for _, r := range raw {
		if r < 0x20 || r == 0x7f {
			return defaultRedirect
		}
	}
	return raw
}
