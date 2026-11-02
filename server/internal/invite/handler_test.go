package invite_test

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/bowlinedandy/spraywall/server/db/generated"
	"github.com/bowlinedandy/spraywall/server/internal/invite"
	"github.com/bowlinedandy/spraywall/server/internal/shared"
	"github.com/bowlinedandy/spraywall/server/internal/testdb"
	"github.com/bowlinedandy/spraywall/server/internal/user"
)

func TestInviteCanOnlyBeAcceptedOnceConcurrently(t *testing.T) {
	ctx := context.Background()
	pool := testdb.New(t)
	q := generated.New(pool)
	createUser := func(email string, role generated.UserRole) generated.User {
		t.Helper()
		u, err := q.CreateUser(ctx, generated.CreateUserParams{Email: email, DisplayName: "Test", Role: role})
		if err != nil {
			t.Fatal(err)
		}
		return u
	}
	owner := createUser("invite-owner-"+uuid.NewString()+"@example.com", generated.UserRoleAdmin)
	first := createUser("invite-first-"+uuid.NewString()+"@example.com", generated.UserRoleClimber)
	second := createUser("invite-second-"+uuid.NewString()+"@example.com", generated.UserRoleClimber)
	inv, err := q.CreateInvite(ctx, generated.CreateInviteParams{
		Token: uuid.NewString(), CreatedBy: owner.ID, Role: generated.UserRoleAdmin,
		ExpiresAt: shared.PgTimestamptz(time.Now().Add(time.Hour)),
	})
	if err != nil {
		t.Fatal(err)
	}

	// Both handlers read the unused invite before the first consume can commit.
	trigger := fmt.Sprintf(`CREATE FUNCTION delay_invite_acceptance() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.id = '%s'::uuid THEN PERFORM pg_sleep(0.3); END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER delay_invite_acceptance BEFORE UPDATE OF used_at ON invites FOR EACH ROW EXECUTE FUNCTION delay_invite_acceptance();`, shared.UUIDFromPg(inv.ID))
	if _, err := pool.Exec(ctx, trigger); err != nil {
		t.Fatal(err)
	}

	auth := user.NewHandler(q, "invite-test-secret", pool, user.Options{PasswordEnabled: true})
	handler := invite.NewHandler(q, pool)
	router := chi.NewRouter()
	router.Route("/invites/{token}", func(r chi.Router) {
		r.Use(auth.Authenticate)
		r.Post("/accept", handler.AcceptInvite)
	})
	tokens := make([]string, 2)
	for i, account := range []generated.User{first, second} {
		pair, err := auth.IssueTokens(ctx, q, account)
		if err != nil {
			t.Fatal(err)
		}
		tokens[i] = pair.AccessToken
	}
	start := make(chan struct{})
	statuses := make(chan int, 2)
	var wg sync.WaitGroup
	for _, token := range tokens {
		wg.Add(1)
		go func(token string) {
			defer wg.Done()
			<-start
			request := httptest.NewRequest(http.MethodPost, "/invites/"+inv.Token+"/accept", strings.NewReader(""))
			request.Header.Set("Authorization", "Bearer "+token)
			response := httptest.NewRecorder()
			router.ServeHTTP(response, request)
			statuses <- response.Code
		}(token)
	}
	close(start)
	wg.Wait()
	close(statuses)
	success, conflict := 0, 0
	for status := range statuses {
		switch status {
		case http.StatusOK:
			success++
		case http.StatusConflict:
			conflict++
		default:
			t.Errorf("invite accept status = %d, want 200 or 409", status)
		}
	}
	if success != 1 || conflict != 1 {
		t.Fatalf("accept outcomes: %d successes, %d conflicts; want one each", success, conflict)
	}
	var admins int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM users WHERE role='admin'`).Scan(&admins); err != nil {
		t.Fatal(err)
	}
	if admins != 2 {
		t.Fatalf("admin users = %d, want owner and accepted invitee", admins)
	}
}

func TestAcceptInvitePromotesWithoutDemoting(t *testing.T) {
	ctx := context.Background()
	pool := testdb.New(t)
	q := generated.New(pool)
	admin, err := q.CreateUser(ctx, generated.CreateUserParams{Email: "admin@example.com", DisplayName: "Admin", Role: generated.UserRoleAdmin})
	if err != nil {
		t.Fatal(err)
	}
	climber, err := q.CreateUser(ctx, generated.CreateUserParams{Email: "climber@example.com", DisplayName: "Climber", Role: generated.UserRoleClimber})
	if err != nil {
		t.Fatal(err)
	}
	makeInvite := func(role generated.UserRole) string {
		t.Helper()
		invite, err := q.CreateInvite(ctx, generated.CreateInviteParams{Token: uuid.NewString(), CreatedBy: admin.ID, Role: role, ExpiresAt: shared.PgTimestamptz(time.Now().Add(time.Hour))})
		if err != nil {
			t.Fatal(err)
		}
		return invite.Token
	}
	auth := user.NewHandler(q, "invite-test-secret", pool, user.Options{PasswordEnabled: true})
	pair, err := auth.IssueTokens(ctx, q, climber)
	if err != nil {
		t.Fatal(err)
	}
	handler := invite.NewHandler(q, pool)
	router := chi.NewRouter()
	router.Route("/invites/{token}", func(r chi.Router) {
		r.Use(auth.Authenticate)
		r.Post("/accept", handler.AcceptInvite)
	})
	accept := func(token string) int {
		request := httptest.NewRequest(http.MethodPost, "/invites/"+token+"/accept", nil)
		request.Header.Set("Authorization", "Bearer "+pair.AccessToken)
		response := httptest.NewRecorder()
		router.ServeHTTP(response, request)
		return response.Code
	}
	if status := accept(makeInvite(generated.UserRoleSetter)); status != http.StatusOK {
		t.Fatalf("accept setter invite: %d", status)
	}
	updated, err := q.GetUserByID(ctx, climber.ID)
	if err != nil || updated.Role != generated.UserRoleSetter {
		t.Fatalf("promoted role = %v, err=%v", updated.Role, err)
	}
	if status := accept(makeInvite(generated.UserRoleClimber)); status != http.StatusOK {
		t.Fatalf("accept climber invite as setter: %d", status)
	}
	updated, err = q.GetUserByID(ctx, climber.ID)
	if err != nil || updated.Role != generated.UserRoleSetter {
		t.Fatalf("role after lower invite = %v, err=%v", updated.Role, err)
	}
}
