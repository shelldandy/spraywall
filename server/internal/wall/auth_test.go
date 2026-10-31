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
	pool *pgxpool.Pool
	q    *generated.Queries
	// auth issues tokens without demoting admins; requests are authenticated
	// by the router's handler, which may expire admin roles.
	auth   *user.Handler
	router chi.Router
}

// newAuthEnv wires gym routes through Authenticate as main.go does.
func newAuthEnv(t *testing.T, opts user.Options) *authEnv {
	t.Helper()
	pool := testdb.New(t)
	q := generated.New(pool)
	authn := user.NewHandler(q, testJWTSecret, pool, opts)
	walls := wall.NewHandler(q, nil, pool)
	invites := invite.NewHandler(q, pool)

	r := chi.NewRouter()
	r.Route("/gyms", func(r chi.Router) {
		r.Use(authn.Authenticate)
		r.Post("/", walls.CreateGym)
	})
	r.Route("/gyms/{gymSlug}", func(r chi.Router) {
		r.Use(authn.Authenticate)
		r.Delete("/", walls.DeleteGym)
		r.Post("/invites", invites.CreateInvite)
	})
	return &authEnv{
		pool:   pool,
		q:      q,
		auth:   user.NewHandler(q, testJWTSecret, pool, user.Options{PasswordEnabled: true}),
		router: r,
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

// createGym creates a gym owned by (and with a membership for) a fresh
// climber, so the admins in these tests are not members.
func (e *authEnv) createGym(t *testing.T, slug string) generated.Gym {
	t.Helper()
	owner := e.createUser(t, slug+"-owner@example.com", generated.UserRoleClimber)
	gym, err := e.q.CreateGym(context.Background(), generated.CreateGymParams{Name: slug, Slug: slug, OwnerID: owner.ID})
	if err != nil {
		t.Fatal(err)
	}
	if err := e.q.CreateGymMember(context.Background(), generated.CreateGymMemberParams{
		GymID: gym.ID, UserID: owner.ID, Role: generated.UserRoleAdmin,
	}); err != nil {
		t.Fatal(err)
	}
	return gym
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

func (e *authEnv) gymExists(t *testing.T, slug string) bool {
	t.Helper()
	var n int
	if err := e.pool.QueryRow(context.Background(), "SELECT count(*) FROM gyms WHERE slug = $1", slug).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n == 1
}

func (e *authEnv) inviteCount(t *testing.T) int {
	t.Helper()
	var n int
	if err := e.pool.QueryRow(context.Background(), "SELECT count(*) FROM invites").Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func TestCreateGymRollsBackWhenOwnerMembershipFails(t *testing.T) {
	env := newAuthEnv(t, user.Options{PasswordEnabled: true})
	creator := env.createUser(t, "atomic-gym@example.com", generated.UserRoleClimber)
	token := env.accessToken(t, creator)
	if _, err := env.pool.Exec(context.Background(), `ALTER TABLE gym_members ADD CONSTRAINT reject_admin_members CHECK (role <> 'admin'::user_role)`); err != nil {
		t.Fatal(err)
	}

	rec := env.request(http.MethodPost, "/gyms", token, `{"name":"Atomic Gym","slug":"atomic-gym"}`)
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("create gym status = %d, want 500: %s", rec.Code, rec.Body)
	}
	if env.gymExists(t, "atomic-gym") {
		t.Fatal("gym row committed after owner membership failed")
	}
}

func TestCurrentAdminTokenManagesAnyGym(t *testing.T) {
	env := newAuthEnv(t, user.Options{PasswordEnabled: true})
	admin := env.createUser(t, "admin@example.com", generated.UserRoleAdmin)
	env.createGym(t, "invite-gym")
	env.createGym(t, "delete-gym")
	token := env.accessToken(t, admin)

	if rec := env.request(http.MethodPost, "/gyms/invite-gym/invites", token, `{"role":"admin"}`); rec.Code != http.StatusCreated {
		t.Fatalf("create invite: %d %s", rec.Code, rec.Body)
	}
	if rec := env.request(http.MethodDelete, "/gyms/delete-gym", token, ""); rec.Code != http.StatusNoContent {
		t.Fatalf("delete gym: %d %s", rec.Code, rec.Body)
	}
	if env.gymExists(t, "delete-gym") {
		t.Fatal("gym not deleted")
	}
}

func TestRevokedAdminTokenCannotDeleteGym(t *testing.T) {
	env := newAuthEnv(t, user.Options{PasswordEnabled: true})
	admin := env.createUser(t, "admin@example.com", generated.UserRoleAdmin)
	env.createGym(t, "victim-gym")
	token := env.accessToken(t, admin)
	// Same revocation as an account takeover or password change.
	if _, err := env.q.BumpTokenVersion(context.Background(), admin.ID); err != nil {
		t.Fatal(err)
	}

	rec := env.request(http.MethodDelete, "/gyms/victim-gym", token, "")
	if rec.Code != http.StatusUnauthorized || !strings.Contains(rec.Body.String(), "session revoked") {
		t.Fatalf("revoked token: %d %s", rec.Code, rec.Body)
	}
	if !env.gymExists(t, "victim-gym") {
		t.Fatal("gym deleted with a revoked token")
	}
}

func TestRevokedAdminTokenCannotCreateInvite(t *testing.T) {
	env := newAuthEnv(t, user.Options{PasswordEnabled: true})
	admin := env.createUser(t, "admin@example.com", generated.UserRoleAdmin)
	env.createGym(t, "other-gym")
	token := env.accessToken(t, admin)
	if _, err := env.q.BumpTokenVersion(context.Background(), admin.ID); err != nil {
		t.Fatal(err)
	}

	if rec := env.request(http.MethodPost, "/gyms/other-gym/invites", token, `{"role":"admin"}`); rec.Code != http.StatusUnauthorized {
		t.Fatalf("revoked token: %d %s", rec.Code, rec.Body)
	}
	if n := env.inviteCount(t); n != 0 {
		t.Fatalf("revoked token created %d invites", n)
	}
}

func TestExpiredAdminRoleCannotDeleteGym(t *testing.T) {
	env := newAuthEnv(t, user.Options{PasswordEnabled: true, AdminRoleMaxAge: time.Hour})
	// Admin never confirmed by an SSO login (role_synced_at unset), holding
	// an access token whose role claim still says admin.
	admin := env.createUser(t, "stale-admin@example.com", generated.UserRoleAdmin)
	env.createGym(t, "victim-gym")
	token := env.accessToken(t, admin)

	rec := env.request(http.MethodDelete, "/gyms/victim-gym", token, "")
	if rec.Code != http.StatusForbidden && rec.Code != http.StatusNotFound {
		t.Fatalf("expired admin: %d %s", rec.Code, rec.Body)
	}
	if !env.gymExists(t, "victim-gym") {
		t.Fatal("gym deleted by an expired admin")
	}
	// Authentication does not persist the demotion; IssueTokens does.
	if u, _ := env.q.GetUserByID(context.Background(), admin.ID); u.Role != generated.UserRoleAdmin {
		t.Fatalf("role written during authentication: %s", u.Role)
	}
}
