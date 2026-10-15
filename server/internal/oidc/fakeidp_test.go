package oidc

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"sync"
	"testing"
	"time"

	"github.com/go-jose/go-jose/v4"
)

const (
	testClientID     = "spraywall-test"
	testClientSecret = "test-secret"
)

// fakeIdP is a minimal in-process OpenID provider: discovery, JWKS, token
// (with PKCE verification), UserInfo, and a static picture endpoint.
type fakeIdP struct {
	t      *testing.T
	server *httptest.Server
	signer jose.Signer
	key    *rsa.PrivateKey

	mu       sync.Mutex
	grants   map[string]*grant // by authorization code
	byAccess map[string]*grant // by access token

	pictureHits int
	picture     []byte
}

type grant struct {
	nonce     string
	challenge string
	claims    map[string]any // ID token claims (beyond the standard ones)
	userinfo  map[string]any // extra UserInfo claims
	// overrideNonce, when set, is put in the ID token instead of nonce.
	overrideNonce string
}

func newFakeIdP(t *testing.T) *fakeIdP {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	signer, err := jose.NewSigner(
		jose.SigningKey{Algorithm: jose.RS256, Key: jose.JSONWebKey{Key: key, KeyID: "test-key"}},
		(&jose.SignerOptions{}).WithType("JWT"),
	)
	if err != nil {
		t.Fatal(err)
	}

	idp := &fakeIdP{
		t:        t,
		signer:   signer,
		key:      key,
		grants:   map[string]*grant{},
		byAccess: map[string]*grant{},
		// Minimal PNG signature is enough for content sniffing.
		picture: append([]byte("\x89PNG\r\n\x1a\n"), make([]byte, 64)...),
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /.well-known/openid-configuration", idp.discovery)
	mux.HandleFunc("GET /jwks", idp.jwks)
	mux.HandleFunc("POST /token", idp.token)
	mux.HandleFunc("GET /userinfo", idp.userinfoHandler)
	mux.HandleFunc("GET /picture.png", func(w http.ResponseWriter, r *http.Request) {
		idp.mu.Lock()
		idp.pictureHits++
		data := idp.picture
		idp.mu.Unlock()
		w.Write(data) //nolint:errcheck
	})
	idp.server = httptest.NewServer(mux)
	t.Cleanup(idp.server.Close)
	return idp
}

func (idp *fakeIdP) issuer() string { return idp.server.URL }

func (idp *fakeIdP) pictureURL() string { return idp.server.URL + "/picture.png" }

func (idp *fakeIdP) discovery(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"issuer":                                idp.issuer(),
		"authorization_endpoint":                idp.issuer() + "/authorize",
		"token_endpoint":                        idp.issuer() + "/token",
		"jwks_uri":                              idp.issuer() + "/jwks",
		"userinfo_endpoint":                     idp.issuer() + "/userinfo",
		"id_token_signing_alg_values_supported": []string{"RS256"},
		"response_types_supported":              []string{"code"},
		"subject_types_supported":               []string{"public"},
	})
}

func (idp *fakeIdP) jwks(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, jose.JSONWebKeySet{Keys: []jose.JSONWebKey{{
		Key: &idp.key.PublicKey, KeyID: "test-key", Algorithm: "RS256", Use: "sig",
	}}})
}

// authorize simulates the user approving the request in authURL and
// returns the code the IdP would send back.
func (idp *fakeIdP) authorize(authURL string, g *grant) string {
	idp.t.Helper()
	u, err := url.Parse(authURL)
	if err != nil {
		idp.t.Fatal(err)
	}
	q := u.Query()
	if q.Get("client_id") != testClientID || q.Get("code_challenge_method") != "S256" {
		idp.t.Fatalf("unexpected authorize request: %s", authURL)
	}
	g.nonce = q.Get("nonce")
	g.challenge = q.Get("code_challenge")
	if g.nonce == "" || g.challenge == "" {
		idp.t.Fatalf("authorize request missing nonce or PKCE challenge: %s", authURL)
	}

	code := randomCode(idp.t)
	idp.mu.Lock()
	idp.grants[code] = g
	idp.mu.Unlock()
	return code
}

func randomCode(t *testing.T) string {
	t.Helper()
	tok, err := randomToken()
	if err != nil {
		t.Fatal(err)
	}
	return tok
}

func (idp *fakeIdP) token(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseForm(); err != nil {
		http.Error(w, "bad form", http.StatusBadRequest)
		return
	}
	clientID, secret, ok := r.BasicAuth()
	if !ok {
		clientID, secret = r.PostForm.Get("client_id"), r.PostForm.Get("client_secret")
	}
	if clientID != testClientID || secret != testClientSecret {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid_client"})
		return
	}

	idp.mu.Lock()
	g := idp.grants[r.PostForm.Get("code")]
	delete(idp.grants, r.PostForm.Get("code"))
	idp.mu.Unlock()
	if g == nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_grant"})
		return
	}
	sum := sha256.Sum256([]byte(r.PostForm.Get("code_verifier")))
	if base64.RawURLEncoding.EncodeToString(sum[:]) != g.challenge {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_grant", "error_description": "PKCE mismatch"})
		return
	}

	nonce := g.nonce
	if g.overrideNonce != "" {
		nonce = g.overrideNonce
	}
	claims := map[string]any{
		"iss":   idp.issuer(),
		"aud":   testClientID,
		"iat":   time.Now().Unix(),
		"exp":   time.Now().Add(5 * time.Minute).Unix(),
		"nonce": nonce,
	}
	for k, v := range g.claims {
		claims[k] = v
	}
	payload, err := json.Marshal(claims)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	jws, err := idp.signer.Sign(payload)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	idToken, err := jws.CompactSerialize()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	access := randomCode(idp.t)
	idp.mu.Lock()
	idp.byAccess[access] = g
	idp.mu.Unlock()

	writeJSON(w, http.StatusOK, map[string]any{
		"access_token": access,
		"token_type":   "Bearer",
		"expires_in":   300,
		"id_token":     idToken,
	})
}

func (idp *fakeIdP) userinfoHandler(w http.ResponseWriter, r *http.Request) {
	const prefix = "Bearer "
	auth := r.Header.Get("Authorization")
	if len(auth) <= len(prefix) {
		w.WriteHeader(http.StatusUnauthorized)
		return
	}
	idp.mu.Lock()
	g := idp.byAccess[auth[len(prefix):]]
	idp.mu.Unlock()
	if g == nil {
		w.WriteHeader(http.StatusUnauthorized)
		return
	}
	info := map[string]any{"sub": g.claims["sub"]}
	for k, v := range g.userinfo {
		info[k] = v
	}
	writeJSON(w, http.StatusOK, info)
}
