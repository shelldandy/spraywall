package wall_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/bowlinedandy/spraywall/server/db/generated"
	"github.com/bowlinedandy/spraywall/server/internal/invite"
	"github.com/bowlinedandy/spraywall/server/internal/testdb"
	"github.com/bowlinedandy/spraywall/server/internal/user"
	"github.com/bowlinedandy/spraywall/server/internal/wall"
)

const testJWTSecret = "secret"

type authEnv struct {
	pool   *pgxpool.Pool
	q      *generated.Queries
	auth   *user.Handler
	router chi.Router
}

func newAuthEnv(t *testing.T, opts user.Options) *authEnv {
	t.Helper()
	pool := testdb.New(t)
	q := generated.New(pool)
	authn := user.NewHandler(q, testJWTSecret, pool, opts)
	walls := wall.NewHandler(q, nil, pool)
	invites := invite.NewHandler(q, pool)

	r := chi.NewRouter()
	r.Route("/walls", func(r chi.Router) {
		r.Use(authn.Authenticate)
		r.Post("/", walls.CreateWall)
		r.Get("/", walls.ListWalls)
		r.Get("/{wallId}", walls.GetWall)
	})
	r.With(authn.Authenticate).Post("/invites", invites.CreateInvite)
	return &authEnv{
		pool: pool, q: q, auth: user.NewHandler(q, testJWTSecret, pool, user.Options{PasswordEnabled: true}), router: r,
	}
}

func (e *authEnv) createUser(t *testing.T, email string, role generated.UserRole) generated.User {
	t.Helper()
	u, err := e.q.CreateUser(context.Background(), generated.CreateUserParams{
		Email: email, DisplayName: "Test", Role: role,
	})
	if err != nil {
		t.Fatal(err)
	}
	return u
}

func (e *authEnv) accessToken(t *testing.T, u generated.User) string {
	t.Helper()
	pair, err := e.auth.IssueTokens(context.Background(), e.q, u)
	if err != nil {
		t.Fatal(err)
	}
	return pair.AccessToken
}

func (e *authEnv) request(method, path, token, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	e.router.ServeHTTP(rec, req)
	return rec
}

func (e *authEnv) inviteCount(t *testing.T) int {
	t.Helper()
	var n int
	if err := e.pool.QueryRow(context.Background(), "SELECT count(*) FROM invites").Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func TestWallsAreVisibleAndWallCreationRequiresSetter(t *testing.T) {
	env := newAuthEnv(t, user.Options{PasswordEnabled: true})
	climber := env.createUser(t, "climber@example.com", generated.UserRoleClimber)
	setter := env.createUser(t, "setter@example.com", generated.UserRoleSetter)
	admin := env.createUser(t, "admin@example.com", generated.UserRoleAdmin)
	climberToken, setterToken, adminToken := env.accessToken(t, climber), env.accessToken(t, setter), env.accessToken(t, admin)

	if rec := env.request(http.MethodPost, "/walls", climberToken, `{"name":"Forbidden"}`); rec.Code != http.StatusForbidden {
		t.Fatalf("climber create wall: %d %s", rec.Code, rec.Body)
	}
	if rec := env.request(http.MethodPost, "/walls", setterToken, `{"name":"Shared wall"}`); rec.Code != http.StatusCreated {
		t.Fatalf("setter create wall: %d %s", rec.Code, rec.Body)
	}
	for _, token := range []string{climberToken, setterToken, adminToken} {
		if rec := env.request(http.MethodGet, "/walls", token, ""); rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "Shared wall") {
			t.Errorf("wall list for signed-in user: %d %s", rec.Code, rec.Body)
		}
	}
}

func TestOnlyAdminCanCreateInvite(t *testing.T) {
	env := newAuthEnv(t, user.Options{PasswordEnabled: true})
	setter := env.createUser(t, "setter@example.com", generated.UserRoleSetter)
	admin := env.createUser(t, "admin@example.com", generated.UserRoleAdmin)
	if rec := env.request(http.MethodPost, "/invites", env.accessToken(t, setter), `{"role":"setter"}`); rec.Code != http.StatusForbidden {
		t.Fatalf("setter invite status = %d: %s", rec.Code, rec.Body)
	}
	if rec := env.request(http.MethodPost, "/invites", env.accessToken(t, admin), `{"role":"setter"}`); rec.Code != http.StatusCreated {
		t.Fatalf("admin invite status = %d: %s", rec.Code, rec.Body)
	}
}

func TestRevokedAdminTokenCannotCreateInvite(t *testing.T) {
	env := newAuthEnv(t, user.Options{PasswordEnabled: true})
	admin := env.createUser(t, "admin@example.com", generated.UserRoleAdmin)
	token := env.accessToken(t, admin)
	if _, err := env.q.BumpTokenVersion(context.Background(), admin.ID); err != nil {
		t.Fatal(err)
	}
	if rec := env.request(http.MethodPost, "/invites", token, `{"role":"admin"}`); rec.Code != http.StatusUnauthorized {
		t.Fatalf("revoked token: %d %s", rec.Code, rec.Body)
	}
	if n := env.inviteCount(t); n != 0 {
		t.Fatalf("revoked token created %d invites", n)
	}
}

func TestExpiredAdminRoleCannotCreateInvite(t *testing.T) {
	env := newAuthEnv(t, user.Options{PasswordEnabled: true, AdminRoleMaxAge: time.Hour})
	admin := env.createUser(t, "stale-admin@example.com", generated.UserRoleAdmin)
	token := env.accessToken(t, admin)
	if rec := env.request(http.MethodPost, "/invites", token, `{"role":"admin"}`); rec.Code != http.StatusForbidden {
		t.Fatalf("expired admin: %d %s", rec.Code, rec.Body)
	}
	if n := env.inviteCount(t); n != 0 {
		t.Fatalf("expired admin created %d invites", n)
	}
	if u, _ := env.q.GetUserByID(context.Background(), admin.ID); u.Role != generated.UserRoleAdmin {
		t.Fatalf("role written during authentication: %s", u.Role)
	}
}
