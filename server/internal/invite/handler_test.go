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
	createUser := func(email string) generated.User {
		t.Helper()
		u, err := q.CreateUser(ctx, generated.CreateUserParams{Email: email, DisplayName: "Test", Role: generated.UserRoleClimber})
		if err != nil {
			t.Fatal(err)
		}
		return u
	}
	owner := createUser("invite-owner-" + uuid.NewString() + "@example.com")
	first := createUser("invite-first-" + uuid.NewString() + "@example.com")
	second := createUser("invite-second-" + uuid.NewString() + "@example.com")
	gym, err := q.CreateGym(ctx, generated.CreateGymParams{Name: "Invite test", Slug: "invite-" + uuid.NewString()[:8], OwnerID: owner.ID})
	if err != nil {
		t.Fatal(err)
	}
	if err := q.CreateGymMember(ctx, generated.CreateGymMemberParams{GymID: gym.ID, UserID: owner.ID, Role: generated.UserRoleAdmin}); err != nil {
		t.Fatal(err)
	}
	inv, err := q.CreateInvite(ctx, generated.CreateInviteParams{
		GymID: gym.ID, Token: uuid.NewString(), CreatedBy: owner.ID,
		Role: generated.UserRoleAdmin, ExpiresAt: shared.PgTimestamptz(time.Now().Add(time.Hour)),
	})
	if err != nil {
		t.Fatal(err)
	}

	// Hold both acceptances after their invite lookup so they contend on the consume operation.
	trigger := fmt.Sprintf(`CREATE FUNCTION delay_invite_acceptance() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.gym_id = '%s'::uuid THEN PERFORM pg_sleep(0.3); END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER delay_invite_acceptance BEFORE INSERT ON gym_members FOR EACH ROW EXECUTE FUNCTION delay_invite_acceptance();`, shared.UUIDFromPg(gym.ID))
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
	var invitedMembers int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM gym_members WHERE gym_id=$1`, gym.ID).Scan(&invitedMembers); err != nil {
		t.Fatal(err)
	}
	if invitedMembers != 2 {
		t.Fatalf("gym has %d members, want owner and one invitee", invitedMembers)
	}
}
