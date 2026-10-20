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
	"github.com/google/uuid"
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
	if r = circuitRequest(e, "DELETE", c.ID+"/routes", e.token, fmt.Sprintf(`{"route_id":%q}`, first.ID)); r.Code != 204 {
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
