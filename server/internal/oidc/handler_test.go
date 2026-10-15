package oidc

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"golang.org/x/crypto/bcrypt"

	"github.com/bowlinedandy/spraywall/server/db/generated"
	"github.com/bowlinedandy/spraywall/server/internal/testdb"
	"github.com/bowlinedandy/spraywall/server/internal/user"
)

const testJWTSecret = "test-jwt-secret"

type fakeStorage struct {
	mu      sync.Mutex
	objects map[string][]byte
	deleted []string
}

func (s *fakeStorage) Upload(_ context.Context, key string, r io.Reader, _ int64, _ string) error {
	data, err := io.ReadAll(r)
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.objects == nil {
		s.objects = map[string][]byte{}
	}
	s.objects[key] = data
	return nil
}

func (s *fakeStorage) Delete(_ context.Context, key string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.objects, key)
	s.deleted = append(s.deleted, key)
	return nil
}

func testConfig(idp *fakeIdP) Config {
	return Config{
		Enabled:      true,
		IssuerURL:    idp.issuer(),
		ClientID:     testClientID,
		ClientSecret: testClientSecret,
		RedirectURL:  "https://spraywall.example.com/api/auth/oidc/callback",
		ProviderName: "Pocket-ID",
		Scopes:       []string{"openid", "email", "profile", "groups"},
		GroupsClaim:  "groups",
	}
}

type testEnv struct {
	h       *Handler
	idp     *fakeIdP
	q       *generated.Queries
	storage *fakeStorage
}

// newTestEnv builds a handler against the fake IdP. withDB requires
// TEST_DATABASE_URL (the test is skipped otherwise).
func newTestEnv(t *testing.T, withDB bool, mutate func(*Config)) *testEnv {
	t.Helper()
	idp := newFakeIdP(t)
	cfg := testConfig(idp)
	if mutate != nil {
		mutate(&cfg)
	}

	env := &testEnv{idp: idp, storage: &fakeStorage{}}
	var (
		pool   user.TxBeginner
		issuer TokenIssuer
	)
	if withDB {
		p := testdb.New(t)
		env.q = generated.New(p)
		pool = p
		issuer = user.NewHandler(env.q, testJWTSecret, p, user.Options{PasswordEnabled: true})
	}
	h, err := New(context.Background(), cfg, env.q, pool, issuer, env.storage, testJWTSecret)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	env.h = h
	return env
}

// startLogin calls /auth/oidc/login and returns the IdP URL and cookies.
func (e *testEnv) startLogin(t *testing.T, redirect string) (string, []*http.Cookie) {
	t.Helper()
	rec := httptest.NewRecorder()
	e.h.Login(rec, httptest.NewRequest(http.MethodGet, "/auth/oidc/login?redirect="+url.QueryEscape(redirect), nil))
	res := rec.Result()
	if res.StatusCode != http.StatusFound {
		t.Fatalf("login status = %d", res.StatusCode)
	}
	return res.Header.Get("Location"), res.Cookies()
}

// startLink calls /auth/oidc/link as userID.
func (e *testEnv) startLink(t *testing.T, userID pgtype.UUID) (string, []*http.Cookie) {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/auth/oidc/link", nil)
	req = req.WithContext(context.WithValue(req.Context(), user.UserIDKey, uuid.UUID(userID.Bytes)))
	rec := httptest.NewRecorder()
	e.h.Link(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("link status = %d: %s", rec.Code, rec.Body)
	}
	var body struct {
		URL string `json:"url"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil || body.URL == "" {
		t.Fatalf("link body: %v %s", err, rec.Body)
	}
	return body.URL, rec.Result().Cookies()
}

func (e *testEnv) callback(t *testing.T, query url.Values, cookies []*http.Cookie) string {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/auth/oidc/callback?"+query.Encode(), nil)
	for _, c := range cookies {
		req.AddCookie(c)
	}
	rec := httptest.NewRecorder()
	e.h.Callback(rec, req)
	res := rec.Result()
	if res.StatusCode != http.StatusFound {
		t.Fatalf("callback status = %d", res.StatusCode)
	}
	cleared := false
	for _, c := range res.Cookies() {
		if c.Name == stateCookieName && c.MaxAge < 0 {
			cleared = true
		}
	}
	if !cleared {
		t.Error("callback did not clear the state cookie")
	}
	return res.Header.Get("Location")
}

// completeFlow approves authURL at the IdP with g and runs the callback.
func (e *testEnv) completeFlow(t *testing.T, authURL string, cookies []*http.Cookie, g *grant) string {
	t.Helper()
	code := e.idp.authorize(authURL, g)
	u, _ := url.Parse(authURL)
	return e.callback(t, url.Values{"code": {code}, "state": {u.Query().Get("state")}}, cookies)
}

func (e *testEnv) login(t *testing.T, redirect string, g *grant) string {
	t.Helper()
	authURL, cookies := e.startLogin(t, redirect)
	return e.completeFlow(t, authURL, cookies, g)
}

type loginResult struct {
	userID   uuid.UUID
	role     string
	redirect string
	refresh  string
}

func parseSuccess(t *testing.T, location string) loginResult {
	t.Helper()
	path, fragment, ok := strings.Cut(location, "#")
	if !ok || path != "/auth/callback" {
		t.Fatalf("expected /auth/callback#..., got %q", location)
	}
	values, err := url.ParseQuery(fragment)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(fragment, "access_token=") {
		t.Errorf("fragment should start with access_token: %q", fragment)
	}
	tok, err := jwt.Parse(values.Get("access_token"), func(*jwt.Token) (any, error) { return []byte(testJWTSecret), nil })
	if err != nil {
		t.Fatalf("access token: %v", err)
	}
	claims := tok.Claims.(jwt.MapClaims)
	sub, _ := claims.GetSubject()
	role, _ := claims["role"].(string)
	if values.Get("refresh_token") == "" {
		t.Fatal("missing refresh token")
	}
	return loginResult{userID: uuid.MustParse(sub), role: role, redirect: values.Get("redirect"), refresh: values.Get("refresh_token")}
}

func idClaims(sub, email string, extra map[string]any) map[string]any {
	m := map[string]any{"sub": sub}
	if email != "" {
		m["email"] = email
		m["email_verified"] = true
	}
	for k, v := range extra {
		m[k] = v
	}
	return m
}

// ---------- tests that need no database ----------

func TestLoginRedirectsToIdPWithStateCookie(t *testing.T) {
	env := newTestEnv(t, false, nil)
	authURL, cookies := env.startLogin(t, "//evil.example.com")

	if !strings.HasPrefix(authURL, env.idp.issuer()+"/authorize?") {
		t.Fatalf("unexpected auth URL %q", authURL)
	}
	q := mustQuery(t, authURL)
	for _, k := range []string{"state", "nonce", "code_challenge"} {
		if q.Get(k) == "" {
			t.Errorf("auth URL missing %s", k)
		}
	}
	if q.Get("scope") != "openid email profile groups" {
		t.Errorf("scope = %q", q.Get("scope"))
	}

	if len(cookies) != 1 || cookies[0].Name != stateCookieName {
		t.Fatalf("expected state cookie, got %v", cookies)
	}
	c := cookies[0]
	if !c.HttpOnly || !c.Secure || c.SameSite != http.SameSiteLaxMode || c.Path != "/" {
		t.Errorf("unexpected cookie attributes: %+v", c)
	}
	st, err := decodeState(env.h.stateKey, c.Value, env.h.now())
	if err != nil {
		t.Fatal(err)
	}
	if st.Redirect != "/walls" || st.Mode != modeLogin || st.State != q.Get("state") {
		t.Errorf("unexpected state %+v", st)
	}
}

func TestInsecureCookieForHTTPRedirect(t *testing.T) {
	env := newTestEnv(t, false, func(c *Config) { c.RedirectURL = "http://localhost:8080/auth/oidc/callback" })
	_, cookies := env.startLogin(t, "/walls")
	if cookies[0].Secure {
		t.Error("cookie should not be Secure for http redirect URL")
	}
}

func TestCallbackStateErrors(t *testing.T) {
	env := newTestEnv(t, false, nil)

	if loc := env.callback(t, url.Values{"code": {"x"}, "state": {"y"}}, nil); loc != "/login?error=state_invalid" {
		t.Errorf("missing cookie: got %q", loc)
	}

	bogus := []*http.Cookie{{Name: stateCookieName, Value: "garbage.value"}}
	if loc := env.callback(t, url.Values{"code": {"x"}, "state": {"y"}}, bogus); loc != "/login?error=state_invalid" {
		t.Errorf("tampered cookie: got %q", loc)
	}

	_, cookies := env.startLogin(t, "/walls")
	if loc := env.callback(t, url.Values{"code": {"x"}, "state": {"wrong"}}, cookies); loc != "/login?error=state_invalid" {
		t.Errorf("state mismatch: got %q", loc)
	}

	_, cookies = env.startLogin(t, "/walls")
	if loc := env.callback(t, url.Values{"error": {"access_denied"}}, cookies); loc != "/login?error=access_denied" {
		t.Errorf("idp error: got %q", loc)
	}

	authURL, cookies := env.startLogin(t, "/walls")
	if loc := env.callback(t, url.Values{"code": {"unknown"}, "state": {mustQuery(t, authURL).Get("state")}}, cookies); loc != "/login?error=oidc_failed" {
		t.Errorf("bad code: got %q", loc)
	}
}

func TestCallbackRejectsNonceMismatch(t *testing.T) {
	env := newTestEnv(t, false, nil)
	loc := env.login(t, "/walls", &grant{
		claims:        idClaims("sub-1", "a@example.com", nil),
		overrideNonce: "replayed-nonce",
	})
	if loc != "/login?error=oidc_failed" {
		t.Fatalf("got %q", loc)
	}
}

func TestCallbackRejectsPKCEMismatch(t *testing.T) {
	env := newTestEnv(t, false, nil)
	authURL, cookies := env.startLogin(t, "/walls")
	g := &grant{claims: idClaims("sub-1", "a@example.com", nil)}
	code := env.idp.authorize(authURL, g)
	g.challenge = "not-the-challenge"
	loc := env.callback(t, url.Values{"code": {code}, "state": {mustQuery(t, authURL).Get("state")}}, cookies)
	if loc != "/login?error=oidc_failed" {
		t.Fatalf("got %q", loc)
	}
}

func TestFetchPictureRejectsNonImages(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/html":
			w.Write([]byte("<html><body>hi</body></html>")) //nolint:errcheck
		case "/big":
			w.Write(append([]byte("\x89PNG\r\n\x1a\n"), make([]byte, user.MaxAvatarSize)...)) //nolint:errcheck
		default:
			w.Write([]byte("GIF89a......")) //nolint:errcheck
		}
	}))
	defer srv.Close()

	if _, err := fetchPicture(context.Background(), srv.Client(), srv.URL+"/html"); err == nil {
		t.Error("expected html to be rejected")
	}
	if _, err := fetchPicture(context.Background(), srv.Client(), srv.URL+"/big"); err == nil {
		t.Error("expected oversized picture to be rejected")
	}
	if _, err := fetchPicture(context.Background(), srv.Client(), "file:///etc/passwd"); err == nil {
		t.Error("expected non-http URL to be rejected")
	}
	if _, err := fetchPicture(context.Background(), srv.Client(), srv.URL+"/ok.gif"); err != nil {
		t.Errorf("expected gif to be accepted: %v", err)
	}
}

func TestPictureClientBlocksPrivateHosts(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("GIF89a......")) //nolint:errcheck
	}))
	defer srv.Close()

	// The test server is on loopback, which only the issuer host may use.
	if _, err := fetchPicture(context.Background(), newPictureClient("https://id.example.com"), srv.URL+"/a.gif"); err == nil {
		t.Error("expected loopback picture host to be blocked")
	}
	if _, err := fetchPicture(context.Background(), newPictureClient(srv.URL), srv.URL+"/a.gif"); err != nil {
		t.Errorf("issuer host should be allowed: %v", err)
	}
	// Same host, different port: not the issuer.
	u, _ := url.Parse(srv.URL)
	if _, err := fetchPicture(context.Background(), newPictureClient("http://"+u.Hostname()+":1"), srv.URL+"/a.gif"); err == nil {
		t.Error("issuer host on another port should be blocked")
	}
}

func TestIsPublicAddr(t *testing.T) {
	for addr, want := range map[string]bool{
		"8.8.8.8": true, "2606:4700::1111": true,
		"127.0.0.1": false, "10.1.2.3": false, "172.18.0.5": false, "192.168.1.10": false,
		"169.254.169.254": false, "100.64.0.1": false, "0.0.0.0": false, "::1": false,
		"fd00::1": false, "fe80::1": false, "::ffff:127.0.0.1": false,
		"255.255.255.255": false, "198.18.0.1": false, "240.0.0.1": false, "0.1.2.3": false,
		"64:ff9b::a00:1": false, "2002:a00:1::": false,
	} {
		if got := isPublicAddr(netip.MustParseAddr(addr)); got != want {
			t.Errorf("isPublicAddr(%s) = %v, want %v", addr, got, want)
		}
	}
}

func TestEmailVerifiedFromUserInfo(t *testing.T) {
	c := parseClaims(map[string]any{"email": "a@example.com"}, "groups")
	c.merge(map[string]any{"email": "A@example.com", "email_verified": true}, "groups")
	if !c.EmailVerified {
		t.Error("UserInfo should verify the matching ID token email")
	}
	c = parseClaims(map[string]any{"email": "a@example.com"}, "groups")
	c.merge(map[string]any{"email": "other@example.com", "email_verified": true}, "groups")
	if c.EmailVerified {
		t.Error("verification of a different email must not carry over")
	}
}

func mustQuery(t *testing.T, raw string) url.Values {
	t.Helper()
	u, err := url.Parse(raw)
	if err != nil {
		t.Fatal(err)
	}
	return u.Query()
}

// ---------- database-backed tests ----------

func TestLoginCreatesUserAndReusesIdentity(t *testing.T) {
	env := newTestEnv(t, true, nil)
	ctx := context.Background()

	loc := env.login(t, "/invite/abc", &grant{claims: idClaims("sub-new", "new@example.com", map[string]any{
		"preferred_username": "newbie",
	})})
	first := parseSuccess(t, loc)
	if first.redirect != "/invite/abc" {
		t.Errorf("redirect = %q", first.redirect)
	}
	if first.role != "climber" {
		t.Errorf("role = %q", first.role)
	}

	u, err := env.q.GetUserByID(ctx, pgUUID(first.userID))
	if err != nil {
		t.Fatal(err)
	}
	if u.PasswordHash != "" || u.DisplayName != "newbie" || u.Email != "new@example.com" {
		t.Errorf("unexpected user %+v", u)
	}

	// Same subject with a changed email resolves to the same account and
	// refreshes the stored identity email.
	second := parseSuccess(t, env.login(t, "/walls", &grant{claims: idClaims("sub-new", "renamed@example.com", nil)}))
	if second.userID != first.userID {
		t.Fatalf("identity reuse created a new user")
	}
	idents, err := env.q.ListUserIdentities(ctx, pgUUID(first.userID))
	if err != nil || len(idents) != 1 || idents[0].Email != "renamed@example.com" || idents[0].Issuer != env.idp.issuer() {
		t.Fatalf("unexpected identities %+v, %v", idents, err)
	}
}

func TestLoginEmailLinking(t *testing.T) {
	env := newTestEnv(t, true, nil)
	ctx := context.Background()

	existing, err := env.q.CreateUser(ctx, generated.CreateUserParams{
		Email: "climber@example.com", PasswordHash: "$2a$12$hash", DisplayName: "Climber", Role: generated.UserRoleClimber,
	})
	if err != nil {
		t.Fatal(err)
	}

	// Unverified email must not take over the existing account.
	loc := env.login(t, "/walls", &grant{claims: map[string]any{
		"sub": "sub-unverified", "email": "climber@example.com", "email_verified": false,
	}})
	if loc != "/login?error=email_unverified" {
		t.Fatalf("unverified: got %q", loc)
	}

	// Missing email cannot create an account.
	if loc := env.login(t, "/walls", &grant{claims: map[string]any{"sub": "sub-noemail"}}); loc != "/login?error=email_missing" {
		t.Fatalf("missing email: got %q", loc)
	}

	// Whoever pre-registered the address may have a session and their own
	// linked identity; the verified owner must evict both.
	if _, err := env.q.CreateRefreshToken(ctx, generated.CreateRefreshTokenParams{
		UserID: existing.ID, TokenHash: "squatter", ExpiresAt: pgtype.Timestamptz{Time: time.Now().Add(time.Hour), Valid: true},
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := env.q.CreateUserIdentity(ctx, generated.CreateUserIdentityParams{
		UserID: existing.ID, Issuer: env.idp.issuer(), Subject: "sub-squatter", Email: "squatter@example.com",
	}); err != nil {
		t.Fatal(err)
	}

	// Verified (as a string) links to the existing account, ignoring case.
	res := parseSuccess(t, env.login(t, "/walls", &grant{claims: map[string]any{
		"sub": "sub-verified", "email": "Climber@Example.com", "email_verified": "true",
	}}))
	if res.userID != uuid.UUID(existing.ID.Bytes) {
		t.Fatal("verified email did not link to the existing account")
	}
	idents, err := env.q.ListUserIdentities(ctx, existing.ID)
	if err != nil || len(idents) != 1 || idents[0].Subject != "sub-verified" {
		t.Fatalf("identities = %+v, %v", idents, err)
	}
	u, err := env.q.GetUserByID(ctx, existing.ID)
	if err != nil || u.PasswordHash != "" {
		t.Fatalf("password should be cleared on takeover: %+v, %v", u, err)
	}
	if _, err := env.q.GetRefreshTokenByHash(ctx, "squatter"); err == nil {
		t.Fatal("pre-existing session should be revoked")
	}
	rt, err := env.q.GetRefreshTokenByHash(ctx, hashRefresh(res.refresh))
	if err != nil {
		t.Fatalf("new session missing: %v", err)
	}
	// The owner's session must survive the version bump it caused.
	if rt.TokenVersion != u.TokenVersion {
		t.Fatalf("owner refresh token version %d, user %d", rt.TokenVersion, u.TokenVersion)
	}
}

func TestLoginRefusesUnverifiedNewAccount(t *testing.T) {
	env := newTestEnv(t, true, nil)
	loc := env.login(t, "/walls", &grant{claims: map[string]any{
		"sub": "sub-new", "email": "nobody@example.com", "email_verified": false,
	}})
	if loc != "/login?error=email_unverified" {
		t.Fatalf("got %q", loc)
	}
	if _, err := env.q.GetUserByEmail(context.Background(), "nobody@example.com"); err == nil {
		t.Fatal("account should not be created from an unverified email")
	}
}

func hashRefresh(tok string) string {
	sum := sha256.Sum256([]byte(tok))
	return hex.EncodeToString(sum[:])
}

func TestLoginEmailFromUserInfo(t *testing.T) {
	env := newTestEnv(t, true, nil)
	res := parseSuccess(t, env.login(t, "/walls", &grant{
		claims:   map[string]any{"sub": "sub-ui"},
		userinfo: map[string]any{"email": "ui@example.com", "email_verified": true, "name": "User Info"},
	}))
	u, err := env.q.GetUserByID(context.Background(), pgUUID(res.userID))
	if err != nil || u.Email != "ui@example.com" || u.DisplayName != "User Info" {
		t.Fatalf("unexpected user %+v, %v", u, err)
	}
}

func TestAdminGroupPromotesAndDemotes(t *testing.T) {
	env := newTestEnv(t, true, func(c *Config) { c.AdminGroup = "spraywall-admins" })
	ctx := context.Background()

	res := parseSuccess(t, env.login(t, "/walls", &grant{claims: idClaims("sub-admin", "boss@example.com", map[string]any{
		"groups": []string{"users", "spraywall-admins"},
	})}))
	if res.role != "admin" {
		t.Fatalf("expected admin token, got %q", res.role)
	}
	if u, _ := env.q.GetUserByID(ctx, pgUUID(res.userID)); u.Role != generated.UserRoleAdmin {
		t.Fatalf("db role = %s", u.Role)
	}

	// Groups only available through UserInfo, and no longer in the group.
	res = parseSuccess(t, env.login(t, "/walls", &grant{
		claims:   idClaims("sub-admin", "boss@example.com", nil),
		userinfo: map[string]any{"groups": "users"},
	}))
	if res.role != "climber" {
		t.Fatalf("expected demotion to climber, got %q", res.role)
	}

	// Back in the group via UserInfo.
	res = parseSuccess(t, env.login(t, "/walls", &grant{
		claims:   idClaims("sub-admin", "boss@example.com", nil),
		userinfo: map[string]any{"groups": []string{"spraywall-admins"}},
	}))
	if res.role != "admin" {
		t.Fatalf("expected promotion via userinfo groups, got %q", res.role)
	}
}

func TestRoleUntouchedWithoutAdminGroup(t *testing.T) {
	env := newTestEnv(t, true, nil)
	ctx := context.Background()
	res := parseSuccess(t, env.login(t, "/walls", &grant{claims: idClaims("sub-x", "x@example.com", nil)}))
	if _, err := env.q.UpdateUserRole(ctx, generated.UpdateUserRoleParams{ID: pgUUID(res.userID), Role: generated.UserRoleAdmin}); err != nil {
		t.Fatal(err)
	}
	res = parseSuccess(t, env.login(t, "/walls", &grant{claims: idClaims("sub-x", "x@example.com", map[string]any{"groups": []string{}})}))
	if res.role != "admin" {
		t.Fatalf("role changed without OIDC_ADMIN_GROUP: %q", res.role)
	}
}

func TestLinkMode(t *testing.T) {
	env := newTestEnv(t, true, func(c *Config) { c.AdminGroup = "spraywall-admins" })
	ctx := context.Background()

	hash, _ := bcrypt.GenerateFromPassword([]byte("password1"), bcrypt.MinCost)
	alice, err := env.q.CreateUser(ctx, generated.CreateUserParams{
		Email: "alice@example.com", PasswordHash: string(hash), DisplayName: "Alice", Role: generated.UserRoleClimber,
	})
	if err != nil {
		t.Fatal(err)
	}

	// Email mismatch is allowed when linking; role is not synced.
	authURL, cookies := env.startLink(t, alice.ID)
	loc := env.completeFlow(t, authURL, cookies, &grant{claims: idClaims("sub-alice", "alice@idp.example", map[string]any{
		"groups": []string{"spraywall-admins"},
	})})
	if loc != "/profile?linked=1" {
		t.Fatalf("link: got %q", loc)
	}
	idents, err := env.q.ListUserIdentities(ctx, alice.ID)
	if err != nil || len(idents) != 1 || idents[0].Subject != "sub-alice" || idents[0].Email != "alice@idp.example" {
		t.Fatalf("unexpected identities %+v, %v", idents, err)
	}
	if u, _ := env.q.GetUserByID(ctx, alice.ID); u.Role != generated.UserRoleClimber {
		t.Errorf("link mode changed role to %s", u.Role)
	}

	// Linking the same identity again is a no-op success.
	authURL, cookies = env.startLink(t, alice.ID)
	if loc := env.completeFlow(t, authURL, cookies, &grant{claims: idClaims("sub-alice", "alice@idp.example", nil)}); loc != "/profile?linked=1" {
		t.Fatalf("relink: got %q", loc)
	}

	// Another user cannot claim alice's identity.
	bob, err := env.q.CreateUser(ctx, generated.CreateUserParams{
		Email: "bob@example.com", PasswordHash: string(hash), DisplayName: "Bob", Role: generated.UserRoleClimber,
	})
	if err != nil {
		t.Fatal(err)
	}
	authURL, cookies = env.startLink(t, bob.ID)
	if loc := env.completeFlow(t, authURL, cookies, &grant{claims: idClaims("sub-alice", "alice@idp.example", nil)}); loc != "/profile?error=identity_in_use" {
		t.Fatalf("identity in use: got %q", loc)
	}

	// IdP errors in link mode go back to the profile page.
	_, cookies = env.startLink(t, bob.ID)
	if loc := env.callback(t, url.Values{"error": {"access_denied"}}, cookies); loc != "/profile?error=access_denied" {
		t.Fatalf("link idp error: got %q", loc)
	}
}

func TestPictureSync(t *testing.T) {
	env := newTestEnv(t, true, nil)
	ctx := context.Background()
	claims := idClaims("sub-pic", "pic@example.com", map[string]any{"picture": env.idp.pictureURL()})

	res := parseSuccess(t, env.login(t, "/walls", &grant{claims: claims}))
	u, err := env.q.GetUserByID(ctx, pgUUID(res.userID))
	if err != nil {
		t.Fatal(err)
	}
	if u.AvatarSource.String != user.AvatarSourceOIDC || u.AvatarOriginUrl.String != env.idp.pictureURL() ||
		!strings.HasPrefix(u.AvatarKey.String, "avatars/") || !strings.HasSuffix(u.AvatarKey.String, ".png") {
		t.Fatalf("unexpected avatar columns %+v", u)
	}
	if !bytes.Equal(env.storage.objects[u.AvatarKey.String], env.idp.picture) {
		t.Fatal("picture not stored")
	}

	// Unchanged URL: no re-download.
	parseSuccess(t, env.login(t, "/walls", &grant{claims: claims}))
	if env.idp.pictureHits != 1 {
		t.Fatalf("picture fetched %d times, want 1", env.idp.pictureHits)
	}

	// A user-uploaded avatar is never overwritten.
	if _, err := env.q.UpdateUserAvatar(ctx, generated.UpdateUserAvatarParams{
		ID:           u.ID,
		AvatarKey:    pgtype.Text{String: "avatars/mine.jpg", Valid: true},
		AvatarSource: pgtype.Text{String: user.AvatarSourceUpload, Valid: true},
	}); err != nil {
		t.Fatal(err)
	}
	claims["picture"] = env.idp.pictureURL() + "?v=2"
	parseSuccess(t, env.login(t, "/walls", &grant{claims: claims}))
	u, _ = env.q.GetUserByID(ctx, u.ID)
	if u.AvatarKey.String != "avatars/mine.jpg" || env.idp.pictureHits != 1 {
		t.Fatalf("uploaded avatar was overwritten: %+v (hits %d)", u, env.idp.pictureHits)
	}
}

func TestPictureSyncReplacesOldOIDCAvatar(t *testing.T) {
	env := newTestEnv(t, true, nil)
	ctx := context.Background()
	claims := idClaims("sub-pic2", "pic2@example.com", map[string]any{"picture": env.idp.pictureURL()})
	res := parseSuccess(t, env.login(t, "/walls", &grant{claims: claims}))
	before, _ := env.q.GetUserByID(ctx, pgUUID(res.userID))

	claims["picture"] = env.idp.pictureURL() + "?v=2"
	parseSuccess(t, env.login(t, "/walls", &grant{claims: claims}))
	after, _ := env.q.GetUserByID(ctx, pgUUID(res.userID))
	if after.AvatarKey.String == before.AvatarKey.String {
		t.Fatal("avatar not replaced")
	}
	if _, ok := env.storage.objects[before.AvatarKey.String]; ok {
		t.Fatal("old avatar object not deleted")
	}
}

func pgUUID(id uuid.UUID) pgtype.UUID { return pgtype.UUID{Bytes: id, Valid: true} }

func TestTakeoverVoidsOutstandingSessions(t *testing.T) {
	env := newTestEnv(t, true, nil)
	ctx := context.Background()

	squatter, err := env.q.CreateUser(ctx, generated.CreateUserParams{
		Email: "owner@example.com", PasswordHash: "$2a$12$hash", DisplayName: "Squatter", Role: generated.UserRoleClimber,
	})
	if err != nil {
		t.Fatal(err)
	}
	// The squatter starts linking their own IdP account before the takeover...
	authURL, cookies := env.startLink(t, squatter.ID)

	parseSuccess(t, env.login(t, "/walls", &grant{claims: idClaims("sub-owner", "owner@example.com", nil)}))
	u, err := env.q.GetUserByID(ctx, squatter.ID)
	if err != nil || u.TokenVersion != squatter.TokenVersion+1 {
		t.Fatalf("token version not bumped: %+v, %v", u, err)
	}

	// ...and cannot finish it afterwards.
	loc := env.completeFlow(t, authURL, cookies, &grant{claims: idClaims("sub-squatter", "squatter@idp.example", nil)})
	if loc != "/profile?error=state_invalid" {
		t.Fatalf("stale link: got %q", loc)
	}
	// Nor start a new one with the old access token (version 0 in context).
	req := httptest.NewRequest(http.MethodPost, "/auth/oidc/link", nil)
	req = req.WithContext(context.WithValue(req.Context(), user.UserIDKey, uuid.UUID(squatter.ID.Bytes)))
	rec := httptest.NewRecorder()
	env.h.Link(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("link with revoked session: %d", rec.Code)
	}
}

func TestEmailVerifiedFetchedFromUserInfo(t *testing.T) {
	env := newTestEnv(t, true, nil)
	// The ID token has everything except email_verified.
	res := parseSuccess(t, env.login(t, "/walls", &grant{
		claims: map[string]any{
			"sub": "sub-ev", "email": "ev@example.com", "groups": []string{}, "picture": env.idp.pictureURL(),
		},
		userinfo: map[string]any{"email": "ev@example.com", "email_verified": true},
	}))
	if res.userID == uuid.Nil {
		t.Fatal("expected login to succeed")
	}
}
