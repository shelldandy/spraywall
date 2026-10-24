package wall_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/bowlinedandy/spraywall/server/db/generated"
	"github.com/bowlinedandy/spraywall/server/internal/shared"
	"github.com/bowlinedandy/spraywall/server/internal/testdb"
	"github.com/bowlinedandy/spraywall/server/internal/user"
	"github.com/bowlinedandy/spraywall/server/internal/wall"
)

type resetTestEnv struct {
	pool                                          *pgxpool.Pool
	q                                             *generated.Queries
	router                                        chi.Router
	token                                         string
	wallID, activeID, pendingID, oldHold, newHold uuid.UUID
}

func newResetTestEnv(t *testing.T) *resetTestEnv {
	t.Helper()
	pool := testdb.New(t)
	q := generated.New(pool)
	u, err := q.CreateUser(context.Background(), generated.CreateUserParams{Email: uuid.NewString() + "@example.com", DisplayName: "Setter", Role: generated.UserRoleClimber})
	if err != nil {
		t.Fatal(err)
	}
	gym, err := q.CreateGym(context.Background(), generated.CreateGymParams{Name: "Reset gym", Slug: "reset-" + uuid.NewString()[:8], OwnerID: u.ID})
	if err != nil {
		t.Fatal(err)
	}
	if err := q.CreateGymMember(context.Background(), generated.CreateGymMemberParams{GymID: gym.ID, UserID: u.ID, Role: generated.UserRoleSetter}); err != nil {
		t.Fatal(err)
	}
	wallRow, err := q.CreateWall(context.Background(), generated.CreateWallParams{GymID: gym.ID, Name: "Wall"})
	if err != nil {
		t.Fatal(err)
	}
	var active, pending, oldID, newID uuid.UUID
	if err := pool.QueryRow(context.Background(), `INSERT INTO wall_images(wall_id,storage_key,is_active) VALUES($1,'active.jpg',true) RETURNING id`, wallRow.ID).Scan(&active); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(context.Background(), `INSERT INTO wall_images(wall_id,storage_key,is_active,parent_image_id,reset_kind,review_status,alignment) VALUES($1,'pending.jpg',false,$2,'partial','pending',$3) RETURNING id`, wallRow.ID, active, []byte(`{"homography":[[1,0,0.1],[0,1,0],[0,0,1]],"inliers":12,"ok":true}`)).Scan(&pending); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(context.Background(), `INSERT INTO detection_jobs(wall_image_id,status) VALUES($1,'done')`, pending); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(context.Background(), `INSERT INTO holds(wall_image_id,bbox,confidence) VALUES($1,'{"x":0.1,"y":0.1,"w":0.2,"h":0.2}',0.9) RETURNING id`, active).Scan(&oldID); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(context.Background(), `INSERT INTO holds(wall_image_id,bbox,confidence) VALUES($1,'{"x":0.2,"y":0.2,"w":0.2,"h":0.2}',0.9) RETURNING id`, pending).Scan(&newID); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(context.Background(), `INSERT INTO hold_matches(wall_image_id,old_hold_id,new_hold_id,source,iou) VALUES($1,$2,$3,'auto',0.8)`, pending, oldID, newID); err != nil {
		t.Fatal(err)
	}
	auth := user.NewHandler(q, "reset-test-secret", pool, user.Options{PasswordEnabled: true})
	pair, err := auth.IssueTokens(context.Background(), q, u)
	if err != nil {
		t.Fatal(err)
	}
	r := chi.NewRouter()
	r.Route("/gyms/{gymSlug}", func(r chi.Router) {
		r.Use(auth.Authenticate)
		h := wall.NewHandler(q, nil, pool)
		r.Get("/walls/{wallId}", h.GetWall)
		r.Route("/walls/{wallId}/resets/{imageId}", func(r chi.Router) {
			r.Get("/", h.GetReset)
			r.Put("/matches", h.UpdateResetMatch)
			r.Post("/restore", h.RestoreResetHold)
			r.Post("/apply", h.ApplyReset)
			r.Delete("/", h.DiscardReset)
		})
	})
	return &resetTestEnv{pool: pool, q: q, router: r, token: pair.AccessToken, wallID: shared.UUIDFromPg(wallRow.ID), activeID: active, pendingID: pending, oldHold: oldID, newHold: newID}
}

func (e *resetTestEnv) requestWall() *httptest.ResponseRecorder {
	var slug string
	_ = e.pool.QueryRow(context.Background(), `SELECT slug FROM gyms LIMIT 1`).Scan(&slug)
	req := httptest.NewRequest(http.MethodGet, fmt.Sprintf("/gyms/%s/walls/%s", slug, e.wallID), nil)
	req.Header.Set("Authorization", "Bearer "+e.token)
	rec := httptest.NewRecorder()
	e.router.ServeHTTP(rec, req)
	return rec
}

func (e *resetTestEnv) request(method, suffix, body string) *httptest.ResponseRecorder {
	path := fmt.Sprintf("/gyms/%s/walls/%s/resets/%s%s", "reset-test", e.wallID, e.pendingID, suffix)
	// Look up actual slug for the isolated test gym.
	var slug string
	_ = e.pool.QueryRow(context.Background(), `SELECT slug FROM gyms LIMIT 1`).Scan(&slug)
	path = strings.Replace(path, "/gyms/reset-test/", "/gyms/"+slug+"/", 1)
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+e.token)
	rec := httptest.NewRecorder()
	e.router.ServeHTTP(rec, req)
	return rec
}

func TestResetDiffRestoreMatchApplyPreservesLegacyHistory(t *testing.T) {
	e := newResetTestEnv(t)
	wallDetail := e.requestWall()
	if wallDetail.Code != http.StatusOK || !strings.Contains(wallDetail.Body.String(), `"pending_reset":{"image_id"`) || !strings.Contains(wallDetail.Body.String(), `"detection_status":"done"`) {
		t.Fatalf("pending reset wall metadata: %d %s", wallDetail.Code, wallDetail.Body)
	}
	var restoredOld, missingOld uuid.UUID
	for i, target := range []*uuid.UUID{&restoredOld, &missingOld} {
		bbox := `{"x":0.6,"y":0.5,"w":0.1,"h":0.1}`
		if i == 1 {
			bbox = `{"x":0.7,"y":0.4,"w":0.1,"h":0.1}`
		}
		if err := e.pool.QueryRow(context.Background(), `INSERT INTO holds(wall_image_id,bbox,confidence) VALUES($1,$2,0.7) RETURNING id`, e.activeID, bbox).Scan(target); err != nil {
			t.Fatal(err)
		}
	}
	var keptRoute, legacyRoute, nullRolesRoute, nullArrayRoute, circuit uuid.UUID
	roles := fmt.Sprintf(`{"start":[%q],"finish":[%q],"foot":[%q]}`, e.oldHold, e.oldHold, e.oldHold)
	if err := e.pool.QueryRow(context.Background(), `INSERT INTO routes(wall_id,wall_image_id,created_by,name,hold_ids,hold_roles,status,tags) VALUES($1,$2,(SELECT owner_id FROM gyms LIMIT 1),'kept',$3,$4,'published','{}') RETURNING id`, e.wallID, e.activeID, []uuid.UUID{e.oldHold}, []byte(roles)).Scan(&keptRoute); err != nil {
		t.Fatal(err)
	}
	if err := e.pool.QueryRow(context.Background(), `INSERT INTO routes(wall_id,wall_image_id,created_by,name,hold_ids,hold_roles,status,tags) VALUES($1,$2,(SELECT owner_id FROM gyms LIMIT 1),'legacy',$3,'{}','published','{}') RETURNING id`, e.wallID, e.activeID, []uuid.UUID{missingOld}).Scan(&legacyRoute); err != nil {
		t.Fatal(err)
	}
	if err := e.pool.QueryRow(context.Background(), `INSERT INTO routes(wall_id,wall_image_id,created_by,name,hold_ids,hold_roles,status,tags) VALUES($1,$2,(SELECT owner_id FROM gyms LIMIT 1),'null roles',$3,NULL,'published','{}') RETURNING id`, e.wallID, e.activeID, []uuid.UUID{e.oldHold}).Scan(&nullRolesRoute); err != nil {
		t.Fatal(err)
	}
	nullArrayRoles := fmt.Sprintf(`{"start":null,"finish":[%q]}`, e.oldHold)
	if err := e.pool.QueryRow(context.Background(), `INSERT INTO routes(wall_id,wall_image_id,created_by,name,hold_ids,hold_roles,status,tags) VALUES($1,$2,(SELECT owner_id FROM gyms LIMIT 1),'null role array',$3,$4,'published','{}') RETURNING id`, e.wallID, e.activeID, []uuid.UUID{e.oldHold}, []byte(nullArrayRoles)).Scan(&nullArrayRoute); err != nil {
		t.Fatal(err)
	}
	if err := e.pool.QueryRow(context.Background(), `INSERT INTO circuits(wall_id,created_by,name) VALUES($1,(SELECT owner_id FROM gyms LIMIT 1),'Circuit') RETURNING id`, e.wallID).Scan(&circuit); err != nil {
		t.Fatal(err)
	}
	if _, err := e.pool.Exec(context.Background(), `INSERT INTO circuit_routes(circuit_id,route_id,position) VALUES($1,$2,0)`, circuit, keptRoute); err != nil {
		t.Fatal(err)
	}
	if _, err := e.pool.Exec(context.Background(), `INSERT INTO climb_logs(route_id,user_id,outcome,climbed_on) VALUES($1,(SELECT owner_id FROM gyms LIMIT 1),'send',CURRENT_DATE)`, keptRoute); err != nil {
		t.Fatal(err)
	}

	diff := e.request(http.MethodGet, "/", "")
	if diff.Code != http.StatusOK {
		t.Fatalf("diff %d %s", diff.Code, diff.Body)
	}
	var got struct {
		NewHolds []struct {
			ID      uuid.UUID  `json:"id"`
			Matched *uuid.UUID `json:"matched_old_hold_id"`
		} `json:"new_holds"`
		Removed []struct {
			OldID uuid.UUID          `json:"old_hold_id"`
			BBox  map[string]float64 `json:"bbox"`
		} `json:"removed_holds"`
		Alignment struct {
			OK      bool `json:"ok"`
			Inliers int  `json:"inliers"`
		} `json:"alignment"`
		Affected []struct {
			ID      uuid.UUID   `json:"id"`
			Missing []uuid.UUID `json:"missing_hold_ids"`
		} `json:"affected_routes"`
		KeptCount int    `json:"kept_route_count"`
		Detection string `json:"detection_status"`
	}
	if err := json.Unmarshal(diff.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.Detection != "done" || !got.Alignment.OK || got.Alignment.Inliers != 12 {
		t.Fatalf("diff status/alignment %+v", got)
	}
	if len(got.NewHolds) != 1 || got.NewHolds[0].ID != e.newHold || got.NewHolds[0].Matched == nil || *got.NewHolds[0].Matched != e.oldHold {
		t.Fatalf("new hold match %+v", got.NewHolds)
	}
	if len(got.Removed) != 2 {
		t.Fatalf("removed holds %+v", got.Removed)
	}
	removedByID := map[uuid.UUID]map[string]float64{}
	for _, item := range got.Removed {
		removedByID[item.OldID] = item.BBox
	}
	if removedByID[restoredOld]["x"] < 0.4999 || removedByID[restoredOld]["x"] > 0.5001 {
		t.Fatalf("inverse-projected bbox=%v", removedByID[restoredOld])
	}
	if _, ok := removedByID[missingOld]; !ok {
		t.Fatalf("missing old hold not projected: %v", removedByID)
	}
	if got.KeptCount != 3 || len(got.Affected) != 1 || got.Affected[0].ID != legacyRoute || len(got.Affected[0].Missing) != 1 || got.Affected[0].Missing[0] != missingOld {
		t.Fatalf("route diff %+v kept=%d", got.Affected, got.KeptCount)
	}

	restore := e.request(http.MethodPost, "/restore", fmt.Sprintf(`{"old_hold_id":%q}`, restoredOld))
	if restore.Code != http.StatusCreated {
		t.Fatalf("restore %d %s", restore.Code, restore.Body)
	}
	var restored struct {
		ID uuid.UUID `json:"id"`
	}
	if err := json.Unmarshal(restore.Body.Bytes(), &restored); err != nil {
		t.Fatal(err)
	}
	if restored.ID == uuid.Nil {
		t.Fatalf("restore did not return hold id: %s", restore.Body)
	}
	// A null new_hold_id removes the old hold's match.
	if rec := e.request(http.MethodPut, "/matches", fmt.Sprintf(`{"old_hold_id":%q,"new_hold_id":null}`, e.oldHold)); rec.Code != http.StatusOK {
		t.Fatalf("remove match %d %s", rec.Code, rec.Body)
	}
	// Reassigning the old hold and new hold sides replaces both conflicting matches.
	if rec := e.request(http.MethodPut, "/matches", fmt.Sprintf(`{"old_hold_id":%q,"new_hold_id":%q}`, e.oldHold, restored.ID)); rec.Code != http.StatusOK {
		t.Fatalf("match %d %s", rec.Code, rec.Body)
	}
	var count int
	if err := e.pool.QueryRow(context.Background(), `SELECT count(*) FROM hold_matches WHERE wall_image_id=$1 AND (old_hold_id=$2 OR new_hold_id=$3)`, e.pendingID, restoredOld, restored.ID).Scan(&count); err != nil || count != 1 {
		t.Fatalf("conflicting match rows=%d err=%v", count, err)
	}

	apply := e.request(http.MethodPost, "/apply", "")
	if apply.Code != http.StatusOK {
		t.Fatalf("apply %d %s", apply.Code, apply.Body)
	}
	var result struct {
		Kept     int `json:"kept"`
		Archived int `json:"archived"`
	}
	if err := json.Unmarshal(apply.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if result.Kept != 3 || result.Archived != 1 {
		t.Fatalf("counts %+v", result)
	}
	var image uuid.UUID
	var ids []uuid.UUID
	var rawRoles []byte
	if err := e.pool.QueryRow(context.Background(), `SELECT wall_image_id,hold_ids,hold_roles FROM routes WHERE id=$1`, keptRoute).Scan(&image, &ids, &rawRoles); err != nil {
		t.Fatal(err)
	}
	if image != e.pendingID || len(ids) != 1 || ids[0] != restored.ID {
		t.Fatalf("remapped route image=%s ids=%v", image, ids)
	}
	var mappedRoles map[string][]uuid.UUID
	if err := json.Unmarshal(rawRoles, &mappedRoles); err != nil {
		t.Fatal(err)
	}
	for _, role := range []string{"start", "finish", "foot"} {
		if len(mappedRoles[role]) != 1 || mappedRoles[role][0] != restored.ID {
			t.Fatalf("role %s not remapped: %s", role, rawRoles)
		}
	}
	if err := e.pool.QueryRow(context.Background(), `SELECT wall_image_id FROM routes WHERE id=$1`, legacyRoute).Scan(&image); err != nil || image != e.activeID {
		t.Fatalf("legacy route image=%s err=%v", image, err)
	}
	if err := e.pool.QueryRow(context.Background(), `SELECT count(*) FROM climb_logs WHERE route_id=$1`, keptRoute).Scan(&count); err != nil || count != 1 {
		t.Fatalf("logs=%d err=%v", count, err)
	}
	var rolesAreNull bool
	if err := e.pool.QueryRow(context.Background(), `SELECT hold_roles IS NULL FROM routes WHERE id=$1`, nullRolesRoute).Scan(&rolesAreNull); err != nil || !rolesAreNull {
		t.Fatalf("hold_roles NULL=%v err=%v", rolesAreNull, err)
	}
	var nullArrayRaw []byte
	if err := e.pool.QueryRow(context.Background(), `SELECT hold_roles FROM routes WHERE id=$1`, nullArrayRoute).Scan(&nullArrayRaw); err != nil {
		t.Fatal(err)
	}
	var remappedNullArray map[string][]uuid.UUID
	if err := json.Unmarshal(nullArrayRaw, &remappedNullArray); err != nil {
		t.Fatal(err)
	}
	if remappedNullArray["start"] == nil || len(remappedNullArray["start"]) != 0 || len(remappedNullArray["finish"]) != 1 || remappedNullArray["finish"][0] != restored.ID {
		t.Fatalf("null role array was not safely remapped: %s", nullArrayRaw)
	}
	if err := e.pool.QueryRow(context.Background(), `SELECT count(*) FROM circuit_routes WHERE circuit_id=$1 AND route_id=$2`, circuit, keptRoute).Scan(&count); err != nil || count != 1 {
		t.Fatalf("circuit route count=%d err=%v", count, err)
	}
}

func TestDiscardResetDeletesPendingRow(t *testing.T) {
	e := newResetTestEnv(t)
	rec := e.request(http.MethodDelete, "/", "")
	if rec.Code != http.StatusNoContent {
		t.Fatalf("discard %d %s", rec.Code, rec.Body)
	}
	var count int
	if err := e.pool.QueryRow(context.Background(), `SELECT count(*) FROM wall_images WHERE id=$1`, e.pendingID).Scan(&count); err != nil || count != 0 {
		t.Fatalf("pending row count=%d err=%v", count, err)
	}
}

func TestApplyResetRejectsStaleParent(t *testing.T) {
	e := newResetTestEnv(t)
	if _, err := e.pool.Exec(context.Background(), `UPDATE wall_images SET is_active=false WHERE id=$1`, e.activeID); err != nil {
		t.Fatal(err)
	}
	rec := e.request(http.MethodPost, "/apply", "")
	if rec.Code != http.StatusConflict {
		t.Fatalf("stale parent: %d %s", rec.Code, rec.Body)
	}
}
