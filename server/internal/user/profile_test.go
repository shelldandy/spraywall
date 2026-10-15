package user

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"golang.org/x/crypto/bcrypt"

	"github.com/bowlinedandy/spraywall/server/db/generated"
	"github.com/bowlinedandy/spraywall/server/internal/testdb"
)

// ---------- pure logic ----------

type fakeMemberGetter struct {
	member generated.GymMember
	err    error
}

func (f fakeMemberGetter) GetGymMember(context.Context, generated.GetGymMemberParams) (generated.GymMember, error) {
	return f.member, f.err
}

func ctxAs(userID uuid.UUID, role string) context.Context {
	ctx := context.WithValue(context.Background(), UserIDKey, userID)
	return context.WithValue(ctx, UserRoleKey, role)
}

func TestEffectiveGymMember(t *testing.T) {
	gymID := pgUUID(uuid.New())
	userID := uuid.New()
	setter := generated.GymMember{GymID: gymID, UserID: pgUUID(userID), Role: generated.UserRoleSetter}
	dbErr := errors.New("connection reset")

	cases := []struct {
		name     string
		role     string
		getter   fakeMemberGetter
		wantRole generated.UserRole
		wantErr  error
	}{
		{"admin without membership", "admin", fakeMemberGetter{err: pgx.ErrNoRows}, generated.UserRoleAdmin, nil},
		{"admin with lower membership", "admin", fakeMemberGetter{member: setter}, generated.UserRoleAdmin, nil},
		{"admin with db error", "admin", fakeMemberGetter{err: dbErr}, "", dbErr},
		{"climber without membership", "climber", fakeMemberGetter{err: pgx.ErrNoRows}, "", pgx.ErrNoRows},
		{"climber with membership", "climber", fakeMemberGetter{member: setter}, generated.UserRoleSetter, nil},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			m, err := EffectiveGymMember(ctxAs(userID, c.role), c.getter, gymID)
			if !errors.Is(err, c.wantErr) {
				t.Fatalf("err = %v, want %v", err, c.wantErr)
			}
			if err == nil && (m.Role != c.wantRole || m.GymID != gymID || m.UserID != pgUUID(userID)) {
				t.Fatalf("member = %+v, want role %s", m, c.wantRole)
			}
		})
	}
}

func TestHasLoginMethod(t *testing.T) {
	cases := []struct {
		hasPassword, passwordEnabled bool
		remaining                    int64
		want                         bool
	}{
		{true, true, 0, true},
		{false, true, 0, false},
		{true, false, 0, false},
		{false, false, 1, true},
		{false, true, 1, true},
	}
	for _, c := range cases {
		if got := hasLoginMethod(c.hasPassword, c.passwordEnabled, c.remaining); got != c.want {
			t.Errorf("hasLoginMethod(%v, %v, %d) = %v, want %v", c.hasPassword, c.passwordEnabled, c.remaining, got, c.want)
		}
	}
}

func TestSniffAvatarType(t *testing.T) {
	cases := map[string]string{
		"\xff\xd8\xff\xe0\x00\x10JFIF\x00": "jpg",
		"\x89PNG\r\n\x1a\n\x00\x00":        "png",
		"GIF89a\x01\x00":                   "gif",
		"RIFF\x00\x00\x00\x00WEBPVP8 ":     "webp",
	}
	for data, ext := range cases {
		if _, got, ok := SniffAvatarType([]byte(data)); !ok || got != ext {
			t.Errorf("SniffAvatarType(%q) = %q, %v; want %q", data, got, ok, ext)
		}
	}
	if _, _, ok := SniffAvatarType([]byte("<svg xmlns='http://www.w3.org/2000/svg'></svg>")); ok {
		t.Error("svg must be rejected")
	}
}

func TestPasswordDisabledEndpoints(t *testing.T) {
	h := NewHandler(nil, "secret", nil, Options{PasswordEnabled: false})
	for name, fn := range map[string]http.HandlerFunc{
		"register": h.Register, "login": h.Login, "password": h.ChangePassword,
	} {
		rec := httptest.NewRecorder()
		fn(rec, httptest.NewRequest(http.MethodPost, "/", strings.NewReader(`{}`)))
		if rec.Code != http.StatusForbidden || !strings.Contains(rec.Body.String(), "password login disabled") {
			t.Errorf("%s: got %d %s", name, rec.Code, rec.Body)
		}
	}
}

// ---------- database-backed ----------

type fakeStorage struct {
	objects map[string][]byte
}

func (s *fakeStorage) Upload(_ context.Context, key string, r io.Reader, _ int64, _ string) error {
	data, err := io.ReadAll(r)
	if err != nil {
		return err
	}
	s.objects[key] = data
	return nil
}

func (s *fakeStorage) Delete(_ context.Context, key string) error {
	delete(s.objects, key)
	return nil
}

type profileEnv struct {
	h       *Handler
	q       *generated.Queries
	storage *fakeStorage
}

func newProfileEnv(t *testing.T, opts Options) *profileEnv {
	t.Helper()
	pool := testdb.New(t)
	q := generated.New(pool)
	store := &fakeStorage{objects: map[string][]byte{}}
	opts.Storage = store
	return &profileEnv{h: NewHandler(q, "secret", pool, opts), q: q, storage: store}
}

func (e *profileEnv) createUser(t *testing.T, email, password string) generated.User {
	t.Helper()
	hash := ""
	if password != "" {
		b, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.MinCost)
		if err != nil {
			t.Fatal(err)
		}
		hash = string(b)
	}
	u, err := e.q.CreateUser(context.Background(), generated.CreateUserParams{
		Email: email, PasswordHash: hash, DisplayName: "Test", Role: generated.UserRoleClimber,
	})
	if err != nil {
		t.Fatal(err)
	}
	return u
}

func (e *profileEnv) addIdentity(t *testing.T, u generated.User, sub string) generated.UserIdentity {
	t.Helper()
	ident, err := e.q.CreateUserIdentity(context.Background(), generated.CreateUserIdentityParams{
		UserID: u.ID, Issuer: "https://id.example.com", Subject: sub, Email: u.Email,
	})
	if err != nil {
		t.Fatal(err)
	}
	return ident
}

// do runs fn as user u with chi URL params.
func do(fn http.HandlerFunc, u generated.User, method, contentType string, body io.Reader, params map[string]string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, "/", body)
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	rctx := chi.NewRouteContext()
	for k, v := range params {
		rctx.URLParams.Add(k, v)
	}
	ctx := context.WithValue(req.Context(), chi.RouteCtxKey, rctx)
	ctx = context.WithValue(ctx, UserIDKey, uuidFromPg(u.ID))
	rec := httptest.NewRecorder()
	fn(rec, req.WithContext(ctx))
	return rec
}

func doJSON(fn http.HandlerFunc, u generated.User, method, body string) *httptest.ResponseRecorder {
	return do(fn, u, method, "application/json", strings.NewReader(body), nil)
}

func decodeMe(t *testing.T, rec *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rec.Code, rec.Body)
	}
	var m map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &m); err != nil {
		t.Fatal(err)
	}
	return m
}

func TestMeResponse(t *testing.T) {
	env := newProfileEnv(t, Options{PasswordEnabled: true, OIDCIssuer: "https://id.example.com/", OIDCProviderName: "Pocket-ID"})
	u := env.createUser(t, "me@example.com", "")
	env.addIdentity(t, u, "sub-1")
	if _, err := env.q.CreateUserIdentity(context.Background(), generated.CreateUserIdentityParams{
		UserID: u.ID, Issuer: "https://old-idp.example.com", Subject: "x",
	}); err != nil {
		t.Fatal(err)
	}

	me := decodeMe(t, do(env.h.Me, u, http.MethodGet, "", nil, nil))
	if me["has_password"] != false || me["avatar_url"] != nil || me["role"] != "climber" || me["email"] != "me@example.com" {
		t.Fatalf("unexpected me %v", me)
	}
	idents := me["identities"].([]any)
	if len(idents) != 2 {
		t.Fatalf("identities = %v", idents)
	}
	first := idents[0].(map[string]any)
	second := idents[1].(map[string]any)
	if first["provider_name"] != "Pocket-ID" || second["provider_name"] != "https://old-idp.example.com" {
		t.Fatalf("provider names: %v / %v", first, second)
	}
	for _, k := range []string{"id", "issuer", "email", "created_at"} {
		if _, ok := first[k]; !ok {
			t.Errorf("identity missing %s", k)
		}
	}
}

func TestLoginRejectsPasswordlessUser(t *testing.T) {
	env := newProfileEnv(t, Options{PasswordEnabled: true})
	env.createUser(t, "sso@example.com", "")
	rec := httptest.NewRecorder()
	env.h.Login(rec, httptest.NewRequest(http.MethodPost, "/auth/login", strings.NewReader(`{"email":"sso@example.com","password":""}`)))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d", rec.Code)
	}
}

func TestUpdateMe(t *testing.T) {
	env := newProfileEnv(t, Options{PasswordEnabled: true})
	u := env.createUser(t, "name@example.com", "password1")

	if rec := doJSON(env.h.UpdateMe, u, http.MethodPatch, `{"display_name":"   "}`); rec.Code != http.StatusBadRequest {
		t.Fatalf("blank name: %d", rec.Code)
	}
	me := decodeMe(t, doJSON(env.h.UpdateMe, u, http.MethodPatch, `{"display_name":"  Ada  "}`))
	if me["display_name"] != "Ada" || me["has_password"] != true {
		t.Fatalf("unexpected me %v", me)
	}
}

func TestChangePassword(t *testing.T) {
	env := newProfileEnv(t, Options{PasswordEnabled: true})
	ctx := context.Background()
	u := env.createUser(t, "pw@example.com", "oldpassword")
	other, err := env.h.IssueTokens(ctx, env.q, u)
	if err != nil {
		t.Fatal(err)
	}

	if rec := doJSON(env.h.ChangePassword, u, http.MethodPut, `{"current_password":"oldpassword","new_password":"short"}`); rec.Code != http.StatusBadRequest {
		t.Fatalf("short password: %d", rec.Code)
	}
	rec := doJSON(env.h.ChangePassword, u, http.MethodPut, `{"current_password":"wrong","new_password":"newpassword"}`)
	if rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), "current password is incorrect") {
		t.Fatalf("wrong current: %d %s", rec.Code, rec.Body)
	}
	if rec := doJSON(env.h.ChangePassword, u, http.MethodPut, `{"new_password":"newpassword"}`); rec.Code != http.StatusBadRequest {
		t.Fatalf("missing current: %d", rec.Code)
	}

	rec = doJSON(env.h.ChangePassword, u, http.MethodPut, `{"current_password":"oldpassword","new_password":"newpassword"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("change: %d %s", rec.Code, rec.Body)
	}
	var tokens TokenPair
	if err := json.Unmarshal(rec.Body.Bytes(), &tokens); err != nil || tokens.AccessToken == "" || tokens.RefreshToken == "" {
		t.Fatalf("tokens: %v %s", err, rec.Body)
	}

	// Pre-existing sessions are revoked; the new one works.
	if _, err := env.q.GetRefreshTokenByHash(ctx, hashToken(other.RefreshToken)); !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("old refresh token still valid: %v", err)
	}
	if _, err := env.q.GetRefreshTokenByHash(ctx, hashToken(tokens.RefreshToken)); err != nil {
		t.Fatalf("new refresh token missing: %v", err)
	}
	updated, _ := env.q.GetUserByID(ctx, u.ID)
	if bcrypt.CompareHashAndPassword([]byte(updated.PasswordHash), []byte("newpassword")) != nil {
		t.Fatal("password not updated")
	}
}

func TestOIDCOnlyUserCanSetPassword(t *testing.T) {
	env := newProfileEnv(t, Options{PasswordEnabled: true})
	u := env.createUser(t, "sso@example.com", "")
	rec := doJSON(env.h.ChangePassword, u, http.MethodPut, `{"new_password":"firstpassword"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("set password: %d %s", rec.Code, rec.Body)
	}
	updated, _ := env.q.GetUserByID(context.Background(), u.ID)
	if bcrypt.CompareHashAndPassword([]byte(updated.PasswordHash), []byte("firstpassword")) != nil {
		t.Fatal("password not set")
	}
}

func TestUnlinkIdentity(t *testing.T) {
	env := newProfileEnv(t, Options{PasswordEnabled: true})
	ssoOnly := env.createUser(t, "sso@example.com", "")
	last := env.addIdentity(t, ssoOnly, "sub-sso")
	idParam := func(id pgtype.UUID) map[string]string { return map[string]string{"id": uuidFromPg(id).String()} }

	rec := do(env.h.UnlinkIdentity, ssoOnly, http.MethodDelete, "", nil, idParam(last.ID))
	if rec.Code != http.StatusConflict || !strings.Contains(rec.Body.String(), `"error"`) {
		t.Fatalf("last method: %d %s", rec.Code, rec.Body)
	}
	if n, _ := env.q.CountUserIdentities(context.Background(), ssoOnly.ID); n != 1 {
		t.Fatal("identity deleted despite 409")
	}

	// With a second identity, one can go.
	extra := env.addIdentity(t, ssoOnly, "sub-sso-2")
	me := decodeMe(t, do(env.h.UnlinkIdentity, ssoOnly, http.MethodDelete, "", nil, idParam(extra.ID)))
	if len(me["identities"].([]any)) != 1 {
		t.Fatalf("identities after unlink: %v", me["identities"])
	}

	// Someone else's identity is a 404, as is garbage.
	pwUser := env.createUser(t, "pw@example.com", "password1")
	if rec := do(env.h.UnlinkIdentity, pwUser, http.MethodDelete, "", nil, idParam(last.ID)); rec.Code != http.StatusNotFound {
		t.Fatalf("foreign identity: %d", rec.Code)
	}
	if rec := do(env.h.UnlinkIdentity, pwUser, http.MethodDelete, "", nil, map[string]string{"id": "nope"}); rec.Code != http.StatusNotFound {
		t.Fatalf("bad id: %d", rec.Code)
	}

	// Password users can unlink their only identity...
	pwIdent := env.addIdentity(t, pwUser, "sub-pw")
	decodeMe(t, do(env.h.UnlinkIdentity, pwUser, http.MethodDelete, "", nil, idParam(pwIdent.ID)))

	// ...unless password login is disabled.
	disabled := NewHandler(env.q, "secret", env.h.pool, Options{PasswordEnabled: false})
	pwIdent = env.addIdentity(t, pwUser, "sub-pw")
	if rec := do(disabled.UnlinkIdentity, pwUser, http.MethodDelete, "", nil, idParam(pwIdent.ID)); rec.Code != http.StatusConflict {
		t.Fatalf("password disabled: %d", rec.Code)
	}
}

func multipartAvatar(t *testing.T, field string, data []byte) (string, *bytes.Buffer) {
	t.Helper()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	fw, err := mw.CreateFormFile(field, "avatar.png")
	if err != nil {
		t.Fatal(err)
	}
	fw.Write(data) //nolint:errcheck
	mw.Close()     //nolint:errcheck
	return mw.FormDataContentType(), &buf
}

func TestAvatarUploadAndDelete(t *testing.T) {
	env := newProfileEnv(t, Options{PasswordEnabled: true})
	ctx := context.Background()
	u := env.createUser(t, "avatar@example.com", "password1")
	png := append([]byte("\x89PNG\r\n\x1a\n"), make([]byte, 32)...)

	// Pretend the user previously had an OIDC avatar.
	env.storage.objects["avatars/old.png"] = png
	u, err := env.q.UpdateUserAvatar(ctx, generated.UpdateUserAvatarParams{
		ID:              u.ID,
		AvatarKey:       pgtype.Text{String: "avatars/old.png", Valid: true},
		AvatarSource:    pgtype.Text{String: AvatarSourceOIDC, Valid: true},
		AvatarOriginUrl: pgtype.Text{String: "https://id.example.com/p.png", Valid: true},
	})
	if err != nil {
		t.Fatal(err)
	}

	ct, body := multipartAvatar(t, "avatar", []byte("<html>not an image</html>"))
	if rec := do(env.h.UploadAvatar, u, http.MethodPost, ct, body, nil); rec.Code != http.StatusBadRequest {
		t.Fatalf("html upload: %d", rec.Code)
	}
	ct, body = multipartAvatar(t, "file", png)
	if rec := do(env.h.UploadAvatar, u, http.MethodPost, ct, body, nil); rec.Code != http.StatusBadRequest {
		t.Fatalf("wrong field: %d", rec.Code)
	}
	ct, body = multipartAvatar(t, "avatar", append(png, make([]byte, MaxAvatarSize)...))
	if rec := do(env.h.UploadAvatar, u, http.MethodPost, ct, body, nil); rec.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("oversized: %d", rec.Code)
	}

	ct, body = multipartAvatar(t, "avatar", png)
	me := decodeMe(t, do(env.h.UploadAvatar, u, http.MethodPost, ct, body, nil))
	avatarURL, _ := me["avatar_url"].(string)
	if !strings.HasPrefix(avatarURL, "/images/avatars/") || !strings.HasSuffix(avatarURL, ".png") {
		t.Fatalf("avatar_url = %v", me["avatar_url"])
	}
	key := strings.TrimPrefix(avatarURL, "/images/")
	if _, ok := env.storage.objects[key]; !ok {
		t.Fatal("avatar not uploaded")
	}
	if _, ok := env.storage.objects["avatars/old.png"]; ok {
		t.Fatal("previous avatar not deleted")
	}
	u, _ = env.q.GetUserByID(ctx, u.ID)
	if u.AvatarSource.String != AvatarSourceUpload || u.AvatarOriginUrl.Valid {
		t.Fatalf("unexpected avatar columns: %+v", u)
	}

	me = decodeMe(t, do(env.h.DeleteAvatar, u, http.MethodDelete, "", nil, nil))
	if me["avatar_url"] != nil {
		t.Fatalf("avatar_url after delete = %v", me["avatar_url"])
	}
	if len(env.storage.objects) != 0 {
		t.Fatalf("objects left: %v", env.storage.objects)
	}
	u, _ = env.q.GetUserByID(ctx, u.ID)
	if u.AvatarKey.Valid || u.AvatarSource.Valid || u.AvatarOriginUrl.Valid {
		t.Fatalf("avatar columns not cleared: %+v", u)
	}
}

func TestIssueTokensExpiresStaleAdmin(t *testing.T) {
	env := newProfileEnv(t, Options{PasswordEnabled: true, AdminRoleMaxAge: time.Hour})
	ctx := context.Background()

	fresh := env.createUser(t, "fresh@example.com", "")
	fresh, err := env.q.SyncUserRole(ctx, generated.SyncUserRoleParams{ID: fresh.ID, Role: generated.UserRoleAdmin})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := env.h.IssueTokens(ctx, env.q, fresh); err != nil {
		t.Fatal(err)
	}
	if u, _ := env.q.GetUserByID(ctx, fresh.ID); u.Role != generated.UserRoleAdmin {
		t.Fatalf("recently confirmed admin was demoted: %s", u.Role)
	}

	// Admin never (or too long ago) confirmed by SSO, e.g. removed from the
	// group but still refreshing tokens.
	stale := env.createUser(t, "stale@example.com", "")
	stale, err = env.q.UpdateUserRole(ctx, generated.UpdateUserRoleParams{ID: stale.ID, Role: generated.UserRoleAdmin})
	if err != nil {
		t.Fatal(err)
	}
	tokens, err := env.h.IssueTokens(ctx, env.q, stale)
	if err != nil {
		t.Fatal(err)
	}
	if u, _ := env.q.GetUserByID(ctx, stale.ID); u.Role != generated.UserRoleClimber {
		t.Fatalf("stale admin kept role %s", u.Role)
	}
	claims := jwt.MapClaims{}
	if _, err := jwt.ParseWithClaims(tokens.AccessToken, claims, func(*jwt.Token) (any, error) { return []byte("secret"), nil }); err != nil {
		t.Fatal(err)
	}
	if claims["role"] != "climber" {
		t.Fatalf("access token role = %v", claims["role"])
	}

	// Without an IdP-managed admin group, admin roles never expire.
	plain := newProfileEnv(t, Options{PasswordEnabled: true})
	manual := plain.createUser(t, "manual@example.com", "")
	manual, _ = plain.q.UpdateUserRole(ctx, generated.UpdateUserRoleParams{ID: manual.ID, Role: generated.UserRoleAdmin})
	if _, err := plain.h.IssueTokens(ctx, plain.q, manual); err != nil {
		t.Fatal(err)
	}
	if u, _ := plain.q.GetUserByID(ctx, manual.ID); u.Role != generated.UserRoleAdmin {
		t.Fatalf("manual admin demoted without admin group: %s", u.Role)
	}
}

func TestRevokedAccessTokenCannotSetPassword(t *testing.T) {
	env := newProfileEnv(t, Options{PasswordEnabled: true})
	ctx := context.Background()
	u := env.createUser(t, "taken@example.com", "")
	// Simulate a takeover after the caller's token (version 0) was issued.
	if _, err := env.q.BumpTokenVersion(ctx, u.ID); err != nil {
		t.Fatal(err)
	}
	if rec := doJSON(env.h.ChangePassword, u, http.MethodPut, `{"new_password":"attackerpw"}`); rec.Code != http.StatusUnauthorized {
		t.Fatalf("stale token set a password: %d %s", rec.Code, rec.Body)
	}
	if got, _ := env.q.GetUserByID(ctx, u.ID); got.PasswordHash != "" {
		t.Fatal("password was set")
	}
}

func TestRefreshTokenSingleUse(t *testing.T) {
	env := newProfileEnv(t, Options{PasswordEnabled: true})
	u := env.createUser(t, "refresh@example.com", "password1")
	pair, err := env.h.IssueTokens(context.Background(), env.q, u)
	if err != nil {
		t.Fatal(err)
	}
	body := `{"refresh_token":"` + pair.RefreshToken + `"}`
	for i, want := range []int{http.StatusOK, http.StatusUnauthorized} {
		rec := httptest.NewRecorder()
		env.h.Refresh(rec, httptest.NewRequest(http.MethodPost, "/auth/refresh", strings.NewReader(body)))
		if rec.Code != want {
			t.Fatalf("refresh %d: status %d, want %d", i, rec.Code, want)
		}
	}
}

func TestLoginPrefersExactEmailCase(t *testing.T) {
	env := newProfileEnv(t, Options{PasswordEnabled: true})
	env.createUser(t, "Dup@example.com", "first-password")
	env.createUser(t, "dup@example.com", "second-password")
	rec := httptest.NewRecorder()
	env.h.Login(rec, httptest.NewRequest(http.MethodPost, "/auth/login", strings.NewReader(`{"email":"dup@example.com","password":"second-password"}`)))
	if rec.Code != http.StatusOK {
		t.Fatalf("exact-case login failed: %d %s", rec.Code, rec.Body)
	}
}

func TestRefreshRejectsTokenFromBeforeRevocation(t *testing.T) {
	env := newProfileEnv(t, Options{PasswordEnabled: true})
	ctx := context.Background()
	stale := env.createUser(t, "race@example.com", "password1")
	// A login that read the user before a takeover committed...
	if _, err := env.q.BumpTokenVersion(ctx, stale.ID); err != nil {
		t.Fatal(err)
	}
	// ...still inserts its refresh token afterwards, stamped with the old version.
	pair, err := env.h.IssueTokens(ctx, env.q, stale)
	if err != nil {
		t.Fatal(err)
	}
	rec := httptest.NewRecorder()
	env.h.Refresh(rec, httptest.NewRequest(http.MethodPost, "/auth/refresh", strings.NewReader(`{"refresh_token":"`+pair.RefreshToken+`"}`)))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("stale refresh token accepted: %d %s", rec.Code, rec.Body)
	}
}

func TestAdminDemotionKeepsStaleTokenVersion(t *testing.T) {
	env := newProfileEnv(t, Options{PasswordEnabled: true, AdminRoleMaxAge: time.Hour})
	ctx := context.Background()
	u := env.createUser(t, "expired-admin@example.com", "password1")
	stale, err := env.q.UpdateUserRole(ctx, generated.UpdateUserRoleParams{ID: u.ID, Role: generated.UserRoleAdmin})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := env.q.BumpTokenVersion(ctx, u.ID); err != nil {
		t.Fatal(err)
	}
	pair, err := env.h.IssueTokens(ctx, env.q, stale)
	if err != nil {
		t.Fatal(err)
	}
	rec := httptest.NewRecorder()
	env.h.Refresh(rec, httptest.NewRequest(http.MethodPost, "/auth/refresh", strings.NewReader(`{"refresh_token":"`+pair.RefreshToken+`"}`)))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("demotion revived a stale session: %d", rec.Code)
	}
}
