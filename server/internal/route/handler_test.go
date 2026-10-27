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
	pool      *pgxpool.Pool
	q         *generated.Queries
	handler   *routehandler.Handler
	router    chi.Router
	token     string
	other     string
	wallID    uuid.UUID
	creatorID uuid.UUID
	holdIDs   []uuid.UUID
}

type routeTestResponse struct {
	ID             string   `json:"id"`
	Tags           []string `json:"tags"`
	Status         string   `json:"status"`
	BetaVideoCount int      `json:"beta_video_count"`
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
	routeHandler := routehandler.NewHandler(q, pool)
	creatorToken, err := auth.IssueTokens(context.Background(), q, creator)
	if err != nil {
		t.Fatal(err)
	}
	otherToken, err := auth.IssueTokens(context.Background(), q, other)
	if err != nil {
		t.Fatal(err)
	}
	r := chi.NewRouter()
	r.Get("/beta-media/{videoId}/{kind}", routeHandler.ServeBetaMedia)
	r.Route("/users/me", func(r chi.Router) {
		r.Use(auth.Authenticate)
		r.Get("/logbook", routeHandler.Logbook)
	})
	r.Route("/gyms/{gymSlug}", func(r chi.Router) {
		r.Use(auth.Authenticate)
		r.Route("/walls/{wallId}", func(r chi.Router) {
			r.Get("/activity", routehandler.NewHandler(q, pool).WallActivity)
		})
		r.Route("/walls/{wallId}/circuits", func(r chi.Router) {
			h := routeHandler
			r.Get("/", h.ListCircuits)
			r.Post("/", h.CreateCircuit)
			r.Route("/{circuitId}", func(r chi.Router) {
				r.Get("/", h.GetCircuit)
				r.Patch("/", h.PatchCircuit)
				r.Delete("/", h.DeleteCircuit)
				r.Put("/routes", h.ReplaceCircuitRoutes)
				r.Post("/routes", h.AppendCircuitRoute)
				r.Delete("/routes/{routeId}", h.DeleteCircuitRoute)
			})
		})
		r.Route("/walls/{wallId}/routes", func(r chi.Router) {
			h := routeHandler
			r.Post("/", h.CreateRoute)
			r.Get("/", h.ListRoutes)
			r.Route("/{routeId}", func(r chi.Router) {
				r.Get("/", h.GetRoute)
				r.Get("/activity", h.RouteActivity)
				r.Get("/beta-videos", h.RouteBetaVideos)
				r.Post("/beta-videos", h.CreateBetaVideo)
				r.Delete("/beta-videos/{videoId}", h.DeleteBetaVideo)
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
	return &routeTestEnv{pool: pool, q: q, handler: routeHandler, router: r, token: creatorToken.AccessToken, other: otherToken.AccessToken, wallID: uuid.UUID(wall.ID.Bytes), creatorID: uuid.UUID(creator.ID.Bytes), holdIDs: holdIDs}
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

func routeTestImage(t *testing.T, e *routeTestEnv, storageKey string, parent *uuid.UUID, partial, active bool) uuid.UUID {
	t.Helper()
	if _, err := e.pool.Exec(context.Background(), `UPDATE wall_images SET is_active=false WHERE wall_id=$1`, shared.PgUUID(e.wallID)); err != nil {
		t.Fatal(err)
	}
	resetKind := "full"
	var reviewStatus *string
	if partial {
		resetKind = "partial"
		applied := "applied"
		reviewStatus = &applied
	}
	var imageID uuid.UUID
	if err := e.pool.QueryRow(context.Background(), `INSERT INTO wall_images(wall_id,storage_key,is_active,parent_image_id,reset_kind,review_status) VALUES($1,$2,$3,$4,$5,$6) RETURNING id`, shared.PgUUID(e.wallID), storageKey, active, parent, resetKind, reviewStatus).Scan(&imageID); err != nil {
		t.Fatal(err)
	}
	return imageID
}

func routeTestHold(t *testing.T, e *routeTestEnv, imageID uuid.UUID) uuid.UUID {
	t.Helper()
	var holdID uuid.UUID
	if err := e.pool.QueryRow(context.Background(), `INSERT INTO holds(wall_image_id,bbox,confidence) VALUES($1,'{}',1) RETURNING id`, imageID).Scan(&holdID); err != nil {
		t.Fatal(err)
	}
	return holdID
}

func routeTestArchivedRoute(t *testing.T, e *routeTestEnv, imageID uuid.UUID, holdIDs []uuid.UUID, roles string) uuid.UUID {
	t.Helper()
	var routeID uuid.UUID
	if err := e.pool.QueryRow(context.Background(), `INSERT INTO routes(wall_id,wall_image_id,created_by,name,hold_ids,hold_roles,status,tags) VALUES($1,$2,$3,'Archived test',$4,$5,'published','{}') RETURNING id`, shared.PgUUID(e.wallID), imageID, shared.PgUUID(e.creatorID), holdIDs, []byte(roles)).Scan(&routeID); err != nil {
		t.Fatal(err)
	}
	return routeID
}

func TestLegacyRouteRemapAndReactivation(t *testing.T) {
	e := newRouteTestEnv(t)
	var oldImage uuid.UUID
	if err := e.pool.QueryRow(context.Background(), `SELECT id FROM wall_images WHERE wall_id=$1 AND is_active`, shared.PgUUID(e.wallID)).Scan(&oldImage); err != nil {
		t.Fatal(err)
	}

	imageB := routeTestImage(t, e, "partial-b", &oldImage, true, true)
	matchedB := routeTestHold(t, e, imageB)
	missingB := routeTestHold(t, e, imageB)
	if _, err := e.pool.Exec(context.Background(), `INSERT INTO hold_matches(wall_image_id,old_hold_id,new_hold_id,source) VALUES($1,$2,$3,'manual')`, imageB, e.holdIDs[0], matchedB); err != nil {
		t.Fatal(err)
	}
	roles := fmt.Sprintf(`{"start":[%q],"finish":[%q]}`, e.holdIDs[0], e.holdIDs[1])
	routeID := routeTestArchivedRoute(t, e, oldImage, e.holdIDs, roles)

	get := e.request(http.MethodGet, routeID.String(), e.token, "")
	var detail struct {
		IsLegacy        bool                   `json:"is_legacy"`
		ActiveHoldIDs   []uuid.UUID            `json:"active_hold_ids"`
		ActiveHoldRoles map[string][]uuid.UUID `json:"active_hold_roles"`
	}
	if get.Code != http.StatusOK || json.Unmarshal(get.Body.Bytes(), &detail) != nil {
		t.Fatalf("get legacy route: %d %s", get.Code, get.Body)
	}
	if !detail.IsLegacy || len(detail.ActiveHoldIDs) != 1 || detail.ActiveHoldIDs[0] != matchedB {
		t.Fatalf("partial remap legacy=%v holds=%v: %s", detail.IsLegacy, detail.ActiveHoldIDs, get.Body)
	}
	if len(detail.ActiveHoldRoles["start"]) != 1 || detail.ActiveHoldRoles["start"][0] != matchedB || len(detail.ActiveHoldRoles["finish"]) != 0 {
		t.Fatalf("partial role remap: %#v", detail.ActiveHoldRoles)
	}

	foreign := fmt.Sprintf(`{"name":"Foreign","hold_ids":[%q,%q]}`, e.holdIDs[0], e.holdIDs[1])
	if rec := e.request(http.MethodPut, routeID.String(), e.token, foreign); rec.Code != http.StatusBadRequest {
		t.Fatalf("update with foreign holds: %d %s", rec.Code, rec.Body)
	}
	update := fmt.Sprintf(`{"name":"Restored","hold_ids":[%q,%q],"hold_roles":{"start":[%q],"finish":[%q]}}`, matchedB, missingB, matchedB, missingB)
	updated := e.request(http.MethodPut, routeID.String(), e.token, update)
	var updateResult struct {
		WallImageID uuid.UUID `json:"wall_image_id"`
		IsLegacy    bool      `json:"is_legacy"`
	}
	if updated.Code != http.StatusOK || json.Unmarshal(updated.Body.Bytes(), &updateResult) != nil {
		t.Fatalf("update legacy route: %d %s", updated.Code, updated.Body)
	}
	if updateResult.WallImageID != imageB || updateResult.IsLegacy {
		t.Fatalf("updated route image=%s legacy=%v, want %s and false", updateResult.WallImageID, updateResult.IsLegacy, imageB)
	}
	mixedForeign := fmt.Sprintf(`{"name":"Mixed foreign","hold_ids":[%q,%q]}`, matchedB, e.holdIDs[0])
	if rec := e.request(http.MethodPut, routeID.String(), e.token, mixedForeign); rec.Code != http.StatusBadRequest {
		t.Fatalf("update active route with a foreign hold: %d %s", rec.Code, rec.Body)
	}
	var persistedImage uuid.UUID
	if err := e.pool.QueryRow(context.Background(), `SELECT wall_image_id FROM routes WHERE id=$1`, routeID).Scan(&persistedImage); err != nil || persistedImage != imageB {
		t.Fatalf("persisted image=%s err=%v", persistedImage, err)
	}
}

func TestGetRouteRemapsResetChainAndFullReset(t *testing.T) {
	t.Run("chain", func(t *testing.T) {
		e := newRouteTestEnv(t)
		var imageA uuid.UUID
		if err := e.pool.QueryRow(context.Background(), `SELECT id FROM wall_images WHERE wall_id=$1 AND is_active`, shared.PgUUID(e.wallID)).Scan(&imageA); err != nil {
			t.Fatal(err)
		}
		imageB := routeTestImage(t, e, "chain-b", &imageA, true, false)
		holdB := routeTestHold(t, e, imageB)
		if _, err := e.pool.Exec(context.Background(), `INSERT INTO hold_matches(wall_image_id,old_hold_id,new_hold_id,source) VALUES($1,$2,$3,'manual')`, imageB, e.holdIDs[0], holdB); err != nil {
			t.Fatal(err)
		}
		imageC := routeTestImage(t, e, "chain-c", &imageB, true, true)
		holdC := routeTestHold(t, e, imageC)
		if _, err := e.pool.Exec(context.Background(), `INSERT INTO hold_matches(wall_image_id,old_hold_id,new_hold_id,source) VALUES($1,$2,$3,'manual')`, imageC, holdB, holdC); err != nil {
			t.Fatal(err)
		}
		roles := fmt.Sprintf(`{"start":[%q],"finish":[%q]}`, e.holdIDs[0], e.holdIDs[1])
		routeID := routeTestArchivedRoute(t, e, imageA, e.holdIDs, roles)
		rec := e.request(http.MethodGet, routeID.String(), e.token, "")
		var got struct {
			ActiveHoldIDs []uuid.UUID            `json:"active_hold_ids"`
			ActiveRoles   map[string][]uuid.UUID `json:"active_hold_roles"`
		}
		if rec.Code != http.StatusOK || json.Unmarshal(rec.Body.Bytes(), &got) != nil {
			t.Fatalf("get chained route: %d %s", rec.Code, rec.Body)
		}
		if len(got.ActiveHoldIDs) != 1 || got.ActiveHoldIDs[0] != holdC || len(got.ActiveRoles["start"]) != 1 || got.ActiveRoles["start"][0] != holdC || len(got.ActiveRoles["finish"]) != 0 {
			t.Fatalf("chain remap holds=%v roles=%#v", got.ActiveHoldIDs, got.ActiveRoles)
		}
	})

	t.Run("full reset has no ancestry", func(t *testing.T) {
		e := newRouteTestEnv(t)
		var imageA uuid.UUID
		if err := e.pool.QueryRow(context.Background(), `SELECT id FROM wall_images WHERE wall_id=$1 AND is_active`, shared.PgUUID(e.wallID)).Scan(&imageA); err != nil {
			t.Fatal(err)
		}
		routeID := routeTestArchivedRoute(t, e, imageA, e.holdIDs, `{}`)
		routeTestImage(t, e, "full-reset", nil, false, true)
		rec := e.request(http.MethodGet, routeID.String(), e.token, "")
		var got struct {
			IsLegacy      bool        `json:"is_legacy"`
			ActiveHoldIDs []uuid.UUID `json:"active_hold_ids"`
		}
		if rec.Code != http.StatusOK || json.Unmarshal(rec.Body.Bytes(), &got) != nil {
			t.Fatalf("get full-reset route: %d %s", rec.Code, rec.Body)
		}
		if !got.IsLegacy || got.ActiveHoldIDs == nil || len(got.ActiveHoldIDs) != 0 {
			t.Fatalf("full reset remap legacy=%v holds=%v", got.IsLegacy, got.ActiveHoldIDs)
		}
	})
}
