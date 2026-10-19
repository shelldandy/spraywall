package route_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/bowlinedandy/spraywall/server/db/generated"
	routehandler "github.com/bowlinedandy/spraywall/server/internal/route"
	"github.com/bowlinedandy/spraywall/server/internal/shared"
	"github.com/bowlinedandy/spraywall/server/internal/testdb"
	"github.com/bowlinedandy/spraywall/server/internal/user"
)

const routeTestJWTSecret = "route-test-secret"

type routeTestEnv struct {
	pool    *pgxpool.Pool
	q       *generated.Queries
	router  chi.Router
	token   string
	other   string
	wallID  uuid.UUID
	holdIDs []uuid.UUID
}

type routeTestResponse struct {
	ID     string   `json:"id"`
	Tags   []string `json:"tags"`
	Status string   `json:"status"`
}

func newRouteTestEnv(t *testing.T) *routeTestEnv {
	t.Helper()
	pool := testdb.New(t)
	q := generated.New(pool)
	creator, err := q.CreateUser(context.Background(), generated.CreateUserParams{
		Email: "route-creator@example.com", DisplayName: "Creator", Role: generated.UserRoleClimber,
	})
	if err != nil {
		t.Fatal(err)
	}
	other, err := q.CreateUser(context.Background(), generated.CreateUserParams{
		Email: "route-other@example.com", DisplayName: "Other", Role: generated.UserRoleClimber,
	})
	if err != nil {
		t.Fatal(err)
	}
	gym, err := q.CreateGym(context.Background(), generated.CreateGymParams{Name: "Route test gym", Slug: "route-test", OwnerID: creator.ID})
	if err != nil {
		t.Fatal(err)
	}
	if err := q.CreateGymMember(context.Background(), generated.CreateGymMemberParams{GymID: gym.ID, UserID: creator.ID, Role: generated.UserRoleAdmin}); err != nil {
		t.Fatal(err)
	}
	if err := q.CreateGymMember(context.Background(), generated.CreateGymMemberParams{GymID: gym.ID, UserID: other.ID, Role: generated.UserRoleClimber}); err != nil {
		t.Fatal(err)
	}
	wall, err := q.CreateWall(context.Background(), generated.CreateWallParams{GymID: gym.ID, Name: "Test wall"})
	if err != nil {
		t.Fatal(err)
	}
	image, err := q.CreateWallImage(context.Background(), generated.CreateWallImageParams{WallID: wall.ID, StorageKey: "test-image"})
	if err != nil {
		t.Fatal(err)
	}
	holdIDs := make([]uuid.UUID, 0, 2)
	for i := 0; i < 2; i++ {
		hold, err := q.CreateHold(context.Background(), generated.CreateHoldParams{WallImageID: image.ID, Bbox: []byte(`{}`), Confidence: 1})
		if err != nil {
			t.Fatal(err)
		}
		holdIDs = append(holdIDs, uuid.UUID(hold.ID.Bytes))
	}
	auth := user.NewHandler(q, routeTestJWTSecret, pool, user.Options{})
	creatorToken, err := auth.IssueTokens(context.Background(), q, creator)
	if err != nil {
		t.Fatal(err)
	}
	otherToken, err := auth.IssueTokens(context.Background(), q, other)
	if err != nil {
		t.Fatal(err)
	}
	r := chi.NewRouter()
	r.Route("/users/me", func(r chi.Router) {
		r.Use(auth.Authenticate)
		r.Get("/logbook", routehandler.NewHandler(q, pool).Logbook)
	})
	r.Route("/gyms/{gymSlug}", func(r chi.Router) {
		r.Use(auth.Authenticate)
		r.Route("/walls/{wallId}/routes", func(r chi.Router) {
			h := routehandler.NewHandler(q, pool)
			r.Post("/", h.CreateRoute)
			r.Get("/", h.ListRoutes)
			r.Route("/{routeId}", func(r chi.Router) {
				r.Get("/", h.GetRoute)
				r.Put("/", h.UpdateRoute)
				r.Route("/logs", func(r chi.Router) {
					r.Get("/", h.GetLogs)
					r.Post("/", h.CreateLog)
					r.Put("/{logId}", h.UpdateLog)
					r.Delete("/{logId}", h.DeleteLog)
				})
				r.Put("/rating", h.SetRating)
				r.Delete("/rating", h.DeleteRating)
				r.Post("/sends", h.LegacyLogSend)
				r.Delete("/sends/me", h.LegacyRemoveSend)
			})
		})
	})
	return &routeTestEnv{pool: pool, q: q, router: r, token: creatorToken.AccessToken, other: otherToken.AccessToken, wallID: uuid.UUID(wall.ID.Bytes), holdIDs: holdIDs}
}

func (e *routeTestEnv) path(routeID string) string {
	path := fmt.Sprintf("/gyms/route-test/walls/%s/routes", e.wallID)
	if routeID != "" {
		path += "/" + routeID
	}
	return path
}

func (e *routeTestEnv) request(method, routeID, token, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, e.path(routeID), strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	e.router.ServeHTTP(rec, req)
	return rec
}

func (e *routeTestEnv) create(t *testing.T, tagsField string, status string) routeTestResponse {
	t.Helper()
	body := fmt.Sprintf(`{"name":"Test route","hold_ids":[%q,%q],"status":%q%s}`, e.holdIDs[0], e.holdIDs[1], status, tagsField)
	rec := e.request(http.MethodPost, "", e.token, body)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create route: %d %s", rec.Code, rec.Body)
	}
	var response routeTestResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if response.Tags == nil {
		t.Fatalf("create response tags are null: %s", rec.Body)
	}
	return response
}

func (e *routeTestEnv) routeCount(t *testing.T) int {
	t.Helper()
	var count int
	if err := e.pool.QueryRow(context.Background(), "SELECT count(*) FROM routes WHERE wall_id = $1", shared.PgUUID(e.wallID)).Scan(&count); err != nil {
		t.Fatal(err)
	}
	return count
}

func TestRouteTagHTTPContract(t *testing.T) {
	e := newRouteTestEnv(t)
	for _, field := range []string{"", `,"tags":null`} {
		created := e.create(t, field, "published")
		if !reflect.DeepEqual(created.Tags, []string{}) {
			t.Fatalf("create omitted/null tags = %#v, want []", created.Tags)
		}
	}

	created := e.create(t, `,"tags":["compression","pumpy","pumpy"]`, "published")
	if want := []string{"pumpy", "compression"}; !reflect.DeepEqual(created.Tags, want) {
		t.Fatalf("create tags = %#v, want %#v", created.Tags, want)
	}
	list := e.request(http.MethodGet, "", e.token, "")
	if list.Code != http.StatusOK {
		t.Fatalf("list routes: %d %s", list.Code, list.Body)
	}
	var listed []routeTestResponse
	if err := json.Unmarshal(list.Body.Bytes(), &listed); err != nil {
		t.Fatal(err)
	}
	found := false
	for _, item := range listed {
		if item.ID == created.ID {
			found = reflect.DeepEqual(item.Tags, []string{"pumpy", "compression"})
		}
	}
	if !found {
		t.Fatalf("list did not return route tags: %s", list.Body)
	}
	get := e.request(http.MethodGet, created.ID, e.token, "")
	var got routeTestResponse
	if get.Code != http.StatusOK || json.Unmarshal(get.Body.Bytes(), &got) != nil || !reflect.DeepEqual(got.Tags, []string{"pumpy", "compression"}) {
		t.Fatalf("get route tags: %d %s", get.Code, get.Body)
	}

	for _, field := range []string{"", `,"tags":null`} {
		body := fmt.Sprintf(`{"name":"Updated","hold_ids":[%q,%q]%s}`, e.holdIDs[0], e.holdIDs[1], field)
		updated := e.request(http.MethodPut, created.ID, e.token, body)
		var response routeTestResponse
		if updated.Code != http.StatusOK || json.Unmarshal(updated.Body.Bytes(), &response) != nil || !reflect.DeepEqual(response.Tags, []string{"pumpy", "compression"}) {
			t.Fatalf("update omitted/null should preserve tags: %d %s", updated.Code, updated.Body)
		}
	}
	cleared := e.request(http.MethodPut, created.ID, e.token, fmt.Sprintf(`{"name":"Updated","hold_ids":[%q,%q],"tags":[]}`, e.holdIDs[0], e.holdIDs[1]))
	var clearedResponse routeTestResponse
	if cleared.Code != http.StatusOK || json.Unmarshal(cleared.Body.Bytes(), &clearedResponse) != nil || !reflect.DeepEqual(clearedResponse.Tags, []string{}) {
		t.Fatalf("explicit empty tags should clear: %d %s", cleared.Code, cleared.Body)
	}

	before := e.routeCount(t)
	for _, invalid := range []string{`["custom"]`, `["pumpy",1]`, `"pumpy"`, `{}`} {
		body := fmt.Sprintf(`{"name":"Invalid","hold_ids":[%q,%q],"tags":%s}`, e.holdIDs[0], e.holdIDs[1], invalid)
		rec := e.request(http.MethodPost, "", e.token, body)
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("invalid create tags %s: %d %s", invalid, rec.Code, rec.Body)
		}
	}
	if after := e.routeCount(t); after != before {
		t.Fatalf("invalid creates wrote routes: before=%d after=%d", before, after)
	}
	for _, invalid := range []string{`["custom"]`, `["pumpy",1]`, `"pumpy"`, `{}`} {
		body := fmt.Sprintf(`{"name":"Invalid update","hold_ids":[%q,%q],"tags":%s}`, e.holdIDs[0], e.holdIDs[1], invalid)
		rec := e.request(http.MethodPut, created.ID, e.token, body)
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("invalid update tags %s: %d %s", invalid, rec.Code, rec.Body)
		}
	}
	var persisted []string
	var persistedName string
	if err := e.pool.QueryRow(context.Background(), "SELECT tags, name FROM routes WHERE id = $1", uuid.MustParse(created.ID)).Scan(&persisted, &persistedName); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(persisted, []string{}) || persistedName != "Updated" {
		t.Fatalf("invalid updates changed route: tags=%#v name=%q", persisted, persistedName)
	}

	unauthorized := e.request(http.MethodPut, created.ID, e.other, fmt.Sprintf(`{"name":"Retagged","hold_ids":[%q,%q],"tags":["pumpy"]}`, e.holdIDs[0], e.holdIDs[1]))
	if unauthorized.Code != http.StatusForbidden {
		t.Fatalf("non-creator update status = %d, body %s", unauthorized.Code, unauthorized.Body)
	}
	if err := e.pool.QueryRow(context.Background(), "SELECT tags, name FROM routes WHERE id = $1", uuid.MustParse(created.ID)).Scan(&persisted, &persistedName); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(persisted, []string{}) || persistedName != "Updated" {
		t.Fatalf("non-creator changed route: tags=%#v name=%q", persisted, persistedName)
	}

	draft := e.create(t, `,"tags":["crimpy"]`, "draft")
	otherList := e.request(http.MethodGet, "", e.other, "")
	var otherRoutes []routeTestResponse
	if otherList.Code != http.StatusOK || json.Unmarshal(otherList.Body.Bytes(), &otherRoutes) != nil {
		t.Fatalf("other member list: %d %s", otherList.Code, otherList.Body)
	}
	for _, item := range otherRoutes {
		if item.ID == draft.ID {
			t.Fatal("draft route visible to non-creator")
		}
	}
}

func TestRouteTagsMigrationDefaultAndDown(t *testing.T) {
	e := newRouteTestEnv(t)
	_, file, _, _ := runtime.Caller(0)
	migrationPath := filepath.Join(filepath.Dir(file), "..", "..", "db", "migrations", "0014_route_tags.sql")
	migration, err := os.ReadFile(migrationPath)
	if err != nil {
		t.Fatal(err)
	}
	up, down, ok := strings.Cut(string(migration), "-- +goose Down")
	if !ok {
		t.Fatal("migration has no Goose Down section")
	}
	up = strings.TrimPrefix(up, "-- +goose Up")
	if _, err := e.pool.Exec(context.Background(), strings.TrimSpace(down)); err != nil {
		t.Fatalf("migration Down: %v", err)
	}
	// Insert a route using the pre-migration schema, then apply the real Up SQL.
	var routeID uuid.UUID
	if err := e.pool.QueryRow(context.Background(), `INSERT INTO routes (wall_id, wall_image_id, created_by, name, hold_ids, hold_roles, status)
VALUES ($1, (SELECT id FROM wall_images LIMIT 1), (SELECT id FROM users LIMIT 1), 'pre-tags', $2, '{}'::jsonb, 'published') RETURNING id`, shared.PgUUID(e.wallID), []uuid.UUID(e.holdIDs)).Scan(&routeID); err != nil {
		t.Fatalf("insert pre-tag route: %v", err)
	}
	if _, err := e.pool.Exec(context.Background(), strings.TrimSpace(up)); err != nil {
		t.Fatalf("migration Up: %v", err)
	}
	var tags []string
	if err := e.pool.QueryRow(context.Background(), "SELECT tags FROM routes WHERE id = $1", routeID).Scan(&tags); err != nil {
		t.Fatal(err)
	}
	if tags == nil || len(tags) != 0 {
		t.Fatalf("migration default tags = %#v, want empty array", tags)
	}
	if _, err := e.pool.Exec(context.Background(), strings.TrimSpace(down)); err != nil {
		t.Fatalf("migration Down second run: %v", err)
	}
	var exists bool
	if err := e.pool.QueryRow(context.Background(), `SELECT EXISTS (
 SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'routes' AND column_name = 'tags'
)`).Scan(&exists); err != nil {
		t.Fatal(err)
	}
	if exists {
		t.Fatal("migration Down did not remove routes.tags")
	}
}
