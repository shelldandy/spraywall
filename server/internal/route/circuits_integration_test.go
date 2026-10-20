package route_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/bowlinedandy/spraywall/server/db/generated"
	"github.com/bowlinedandy/spraywall/server/internal/shared"
	"github.com/bowlinedandy/spraywall/server/internal/user"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

type circuitHTTP struct {
	ID          string   `json:"id"`
	WallID      string   `json:"wall_id"`
	CreatedBy   string   `json:"created_by"`
	CreatorName string   `json:"creator_name"`
	Name        string   `json:"name"`
	IsShared    bool     `json:"is_shared"`
	IsOwner     bool     `json:"is_owner"`
	RouteIDs    []string `json:"route_ids"`
}

func circuitRequest(e *routeTestEnv, method, suffix, token, body string) *httptest.ResponseRecorder {
	path := fmt.Sprintf("/gyms/route-test/walls/%s/circuits", e.wallID)
	if suffix != "" {
		path += "/" + suffix
	}
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	e.router.ServeHTTP(rec, req)
	return rec
}
func circuitCreate(t *testing.T, e *routeTestEnv, token, name string, shared bool, ids []string) circuitHTTP {
	t.Helper()
	raw, _ := json.Marshal(map[string]any{"name": name, "is_shared": shared, "route_ids": ids})
	rec := circuitRequest(e, http.MethodPost, "", token, string(raw))
	if rec.Code != http.StatusCreated {
		t.Fatalf("create circuit: %d %s", rec.Code, rec.Body)
	}
	var got circuitHTTP
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.ID == "" || got.Name != name {
		t.Fatalf("incomplete circuit response: %s", rec.Body)
	}
	return got
}
func TestCircuitPrivacyVisibilityAndOrdering(t *testing.T) {
	e := newRouteTestEnv(t)
	route := e.create(t, "", "published")
	private := circuitCreate(t, e, e.token, "Private", false, []string{route.ID})
	if r := circuitRequest(e, "GET", private.ID, e.other, ""); r.Code != 404 {
		t.Fatalf("private circuit status %d", r.Code)
	}
	shared := circuitCreate(t, e, e.token, "Shared", true, []string{route.ID})
	got := circuitRequest(e, "GET", shared.ID, e.other, "")
	if got.Code != 200 {
		t.Fatalf("shared GET: %d %s", got.Code, got.Body)
	}
	var value circuitHTTP
	if err := json.Unmarshal(got.Body.Bytes(), &value); err != nil {
		t.Fatal(err)
	}
	if value.IsOwner || len(value.RouteIDs) != 1 {
		t.Fatalf("shared viewer response: %#v", value)
	}
	if r := circuitRequest(e, "PATCH", shared.ID, e.other, `{"name":"Changed"}`); r.Code != 403 {
		t.Fatalf("non-owner PATCH status %d", r.Code)
	}
}
func TestCircuitReplaceAppendAndDeleteSemantics(t *testing.T) {
	e := newRouteTestEnv(t)
	first := e.create(t, "", "published")
	second := e.create(t, ",\"grade\":\"V2\"", "published")
	c := circuitCreate(t, e, e.token, "Order", true, []string{first.ID})
	r := circuitRequest(e, "PUT", c.ID+"/routes", e.token, fmt.Sprintf(`{"route_ids":[%q,%q]}`, second.ID, first.ID))
	if r.Code != 200 {
		t.Fatalf("replace: %d %s", r.Code, r.Body)
	}
	r = circuitRequest(e, "POST", c.ID+"/routes", e.token, fmt.Sprintf(`{"route_id":%q}`, first.ID))
	if r.Code != 200 {
		t.Fatalf("append duplicate: %d %s", r.Code, r.Body)
	}
	var got circuitHTTP
	json.Unmarshal(r.Body.Bytes(), &got)
	if len(got.RouteIDs) != 2 || got.RouteIDs[0] != second.ID || got.RouteIDs[1] != first.ID {
		t.Fatalf("route order: %#v", got.RouteIDs)
	}
	if r = circuitRequest(e, "DELETE", c.ID+"/routes/"+first.ID, e.token, ""); r.Code != 204 {
		t.Fatalf("delete circuit route status %d", r.Code)
	}
	if _, err := e.pool.Exec(context.Background(), `DELETE FROM routes WHERE id=$1`, uuid.MustParse(second.ID)); err != nil {
		t.Fatal(err)
	}
	var count int
	if err := e.pool.QueryRow(context.Background(), `SELECT count(*) FROM circuit_routes WHERE circuit_id=$1`, uuid.MustParse(c.ID)).Scan(&count); err != nil || count != 0 {
		t.Fatalf("cascade count=%d err=%v", count, err)
	}
}
func TestCircuitWallMismatchIsNotFound(t *testing.T) {
	e := newRouteTestEnv(t)
	c := circuitCreate(t, e, e.token, "Mismatch", true, nil)
	gym, err := e.q.GetGymBySlug(context.Background(), "route-test")
	if err != nil {
		t.Fatal(err)
	}
	wall, err := e.q.CreateWall(context.Background(), generated.CreateWallParams{GymID: gym.ID, Name: "Second wall"})
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodGet, fmt.Sprintf("/gyms/route-test/walls/%s/circuits/%s", uuid.UUID(wall.ID.Bytes), c.ID), nil)
	req.Header.Set("Authorization", "Bearer "+e.token)
	rec := httptest.NewRecorder()
	e.router.ServeHTTP(rec, req)
	if rec.Code != 404 {
		t.Fatalf("wall mismatch status %d", rec.Code)
	}
}

func TestCircuitRejectsRouteFromAnotherWallAtomically(t *testing.T) {
	e := newRouteTestEnv(t)
	published := e.create(t, "", "published")
	gym, err := e.q.GetGymBySlug(context.Background(), "route-test")
	if err != nil {
		t.Fatal(err)
	}
	wall, err := e.q.CreateWall(context.Background(), generated.CreateWallParams{GymID: gym.ID, Name: "Other circuit wall"})
	if err != nil {
		t.Fatal(err)
	}
	image, err := e.q.CreateWallImage(context.Background(), generated.CreateWallImageParams{WallID: wall.ID, StorageKey: "other-wall-image"})
	if err != nil {
		t.Fatal(err)
	}
	holds := make([]pgtype.UUID, 0, 2)
	for i := 0; i < 2; i++ {
		hold, createErr := e.q.CreateHold(context.Background(), generated.CreateHoldParams{WallImageID: image.ID, Bbox: []byte(`{}`), Confidence: 1})
		if createErr != nil {
			t.Fatal(createErr)
		}
		holds = append(holds, hold.ID)
	}
	foreign, err := e.q.CreateRoute(context.Background(), generated.CreateRouteParams{WallID: wall.ID, WallImageID: image.ID, CreatedBy: shared.PgUUID(e.creatorID), Name: "Foreign wall route", HoldIds: holds, HoldRoles: []byte(`{}`), Status: "published", Tags: []string{}})
	if err != nil {
		t.Fatal(err)
	}
	c := circuitCreate(t, e, e.token, "Atomic replace", true, []string{published.ID})
	rec := circuitRequest(e, http.MethodPut, c.ID+"/routes", e.token, fmt.Sprintf(`{"route_ids":[%q,%q]}`, published.ID, uuid.UUID(foreign.ID.Bytes)))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("cross-wall replace status %d: %s", rec.Code, rec.Body)
	}
	got := circuitRequest(e, http.MethodGet, c.ID, e.token, "")
	var after circuitHTTP
	if got.Code != http.StatusOK {
		t.Fatalf("circuit get: %d", got.Code)
	}
	if err := json.Unmarshal(got.Body.Bytes(), &after); err != nil {
		t.Fatal(err)
	}
	if len(after.RouteIDs) != 1 || after.RouteIDs[0] != published.ID {
		t.Fatalf("failed replacement changed prior routes: %#v", after.RouteIDs)
	}
}

func TestCircuitDraftVisibilityAndDeletePermissions(t *testing.T) {
	e := newRouteTestEnv(t)
	body := fmt.Sprintf(`{"name":"Other draft","hold_ids":[%q,%q],"status":"draft"}`, e.holdIDs[0], e.holdIDs[1])
	draftResponse := e.request(http.MethodPost, "", e.other, body)
	if draftResponse.Code != http.StatusCreated {
		t.Fatalf("draft create: %d %s", draftResponse.Code, draftResponse.Body)
	}
	var draft routeTestResponse
	if err := json.Unmarshal(draftResponse.Body.Bytes(), &draft); err != nil {
		t.Fatal(err)
	}
	if r := circuitRequest(e, http.MethodPost, "", e.token, fmt.Sprintf(`{"name":"Invalid","is_shared":true,"route_ids":[%q]}`, draft.ID)); r.Code != http.StatusBadRequest {
		t.Fatalf("other draft accepted: %d", r.Code)
	}
	ownBody := fmt.Sprintf(`{"name":"Own draft","hold_ids":[%q,%q],"status":"draft"}`, e.holdIDs[0], e.holdIDs[1])
	ownResponse := e.request(http.MethodPost, "", e.token, ownBody)
	if ownResponse.Code != http.StatusCreated {
		t.Fatalf("own draft: %d %s", ownResponse.Code, ownResponse.Body)
	}
	var own routeTestResponse
	if err := json.Unmarshal(ownResponse.Body.Bytes(), &own); err != nil {
		t.Fatal(err)
	}
	c := circuitCreate(t, e, e.token, "Shared with draft", true, []string{own.ID})
	visible := circuitRequest(e, http.MethodGet, c.ID, e.other, "")
	var other circuitHTTP
	if visible.Code != 200 {
		t.Fatalf("shared GET: %d", visible.Code)
	}
	if err := json.Unmarshal(visible.Body.Bytes(), &other); err != nil {
		t.Fatal(err)
	}
	if len(other.RouteIDs) != 0 {
		t.Fatalf("draft leaked: %#v", other.RouteIDs)
	}
	if r := circuitRequest(e, http.MethodDelete, c.ID, e.other, ""); r.Code != http.StatusForbidden {
		t.Fatalf("other delete: %d", r.Code)
	}
	if r := circuitRequest(e, http.MethodDelete, c.ID, e.token, ""); r.Code != http.StatusNoContent {
		t.Fatalf("owner delete: %d", r.Code)
	}
}

func TestCircuitAdminCanDelete(t *testing.T) {
	e := newRouteTestEnv(t)
	admin, err := e.q.CreateUser(context.Background(), generated.CreateUserParams{Email: "circuits-admin@example.com", DisplayName: "Admin", Role: generated.UserRoleAdmin})
	if err != nil {
		t.Fatal(err)
	}
	auth := user.NewHandler(e.q, routeTestJWTSecret, e.pool, user.Options{})
	tokens, err := auth.IssueTokens(context.Background(), e.q, admin)
	if err != nil {
		t.Fatal(err)
	}
	c := circuitCreate(t, e, e.token, "Admin delete", false, nil)
	r := circuitRequest(e, http.MethodDelete, c.ID, tokens.AccessToken, "")
	if r.Code != http.StatusNoContent {
		t.Fatalf("admin delete: %d %s", r.Code, r.Body)
	}
}
