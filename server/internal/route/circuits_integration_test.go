package route_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
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
	Color       string   `json:"color"`
	Emoji       string   `json:"emoji"`
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
func TestCircuitStyleCreatePatchAndValidation(t *testing.T) {
	e := newRouteTestEnv(t)
	defaults := circuitCreate(t, e, e.token, "Defaults", false, nil)
	if defaults.Color != "violet" || defaults.Emoji != "🧗" {
		t.Fatalf("default style: color=%q emoji=%q", defaults.Color, defaults.Emoji)
	}
	route := e.create(t, "", "published")
	create := circuitRequest(e, http.MethodPost, "", e.token, fmt.Sprintf(`{"name":"Styled","color":"teal","emoji":"⚡","is_shared":true,"route_ids":[%q]}`, route.ID))
	if create.Code != http.StatusCreated {
		t.Fatalf("create styled circuit: %d %s", create.Code, create.Body)
	}
	var got circuitHTTP
	if err := json.Unmarshal(create.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.Color != "teal" || got.Emoji != "⚡" {
		t.Fatalf("created style: color=%q emoji=%q", got.Color, got.Emoji)
	}
	sharedView := circuitRequest(e, http.MethodGet, got.ID, e.other, "")
	var sharedCircuit circuitHTTP
	if sharedView.Code != http.StatusOK || json.Unmarshal(sharedView.Body.Bytes(), &sharedCircuit) != nil || sharedCircuit.Color != got.Color || sharedCircuit.Emoji != got.Emoji {
		t.Fatalf("shared circuit style not visible: %d %s", sharedView.Code, sharedView.Body)
	}
	list := circuitRequest(e, http.MethodGet, "", e.other, "")
	var listed []circuitHTTP
	if list.Code != http.StatusOK || json.Unmarshal(list.Body.Bytes(), &listed) != nil {
		t.Fatalf("list shared circuits: %d %s", list.Code, list.Body)
	}
	foundStyle := false
	for _, circuit := range listed {
		if circuit.ID == got.ID && circuit.Color == got.Color && circuit.Emoji == got.Emoji {
			foundStyle = true
		}
	}
	if !foundStyle {
		t.Fatalf("shared list lost circuit style: %#v", listed)
	}
	patched := circuitRequest(e, http.MethodPatch, got.ID, e.token, `{"color":"pink","emoji":"🏆"}`)
	if patched.Code != http.StatusOK || json.Unmarshal(patched.Body.Bytes(), &got) != nil {
		t.Fatalf("patch style: %d %s", patched.Code, patched.Body)
	}
	if got.Color != "pink" || got.Emoji != "🏆" {
		t.Fatalf("patched style: color=%q emoji=%q", got.Color, got.Emoji)
	}
	if r := circuitRequest(e, http.MethodPost, "", e.token, `{"name":"Bad color","color":"purple"}`); r.Code != http.StatusBadRequest {
		t.Fatalf("invalid create color status %d: %s", r.Code, r.Body)
	}
	if r := circuitRequest(e, http.MethodPost, "", e.token, `{"name":"Bad emoji","emoji":"😀"}`); r.Code != http.StatusBadRequest {
		t.Fatalf("invalid create emoji status %d: %s", r.Code, r.Body)
	}
	if r := circuitRequest(e, http.MethodPatch, got.ID, e.token, `{"color":"purple"}`); r.Code != http.StatusBadRequest {
		t.Fatalf("invalid patch style status %d: %s", r.Code, r.Body)
	}
}

func TestCircuitPrivacyVisibilityAndOrdering(t *testing.T) {
	e := newRouteTestEnv(t)
	route := e.create(t, "", "published")
	private := circuitCreate(t, e, e.token, "Z private", false, []string{route.ID})
	if r := circuitRequest(e, "GET", private.ID, e.other, ""); r.Code != 404 {
		t.Fatalf("private circuit status %d", r.Code)
	}
	if r := circuitRequest(e, http.MethodDelete, private.ID, e.other, ""); r.Code != 404 {
		t.Fatalf("private circuit delete should be hidden: %d", r.Code)
	}
	shared := circuitCreate(t, e, e.token, "A shared", true, []string{route.ID})
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
	if r := circuitRequest(e, "PUT", shared.ID+"/routes", e.other, `{"route_ids":[]}`); r.Code != 403 {
		t.Fatalf("non-owner PUT status %d", r.Code)
	}
	if r := circuitRequest(e, http.MethodDelete, shared.ID+"/routes/"+route.ID, e.other, ""); r.Code != 403 {
		t.Fatalf("non-owner route delete status %d", r.Code)
	}
	circuitCreate(t, e, e.other, "M own", false, nil)

	ownerList := circuitRequest(e, http.MethodGet, "", e.token, "")
	var ownerCircuits []circuitHTTP
	if ownerList.Code != http.StatusOK || json.Unmarshal(ownerList.Body.Bytes(), &ownerCircuits) != nil {
		t.Fatalf("owner circuit list: %d %s", ownerList.Code, ownerList.Body)
	}
	if len(ownerCircuits) != 2 || ownerCircuits[0].Name != "A shared" || ownerCircuits[1].Name != "Z private" {
		t.Fatalf("owner circuits should be first and name-ordered: %#v", ownerCircuits)
	}
	otherList := circuitRequest(e, http.MethodGet, "", e.other, "")
	var otherCircuits []circuitHTTP
	if otherList.Code != http.StatusOK || json.Unmarshal(otherList.Body.Bytes(), &otherCircuits) != nil {
		t.Fatalf("other circuit list: %d %s", otherList.Code, otherList.Body)
	}
	if len(otherCircuits) != 2 || otherCircuits[0].Name != "M own" || otherCircuits[1].Name != "A shared" {
		t.Fatalf("viewer-owned circuits should precede shared circuits: %#v", otherCircuits)
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
	if err := json.Unmarshal(r.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
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
func TestCircuitAppendRequiresRouteAndRespectsLimit(t *testing.T) {
	e := newRouteTestEnv(t)
	var imageID pgtype.UUID
	if err := e.pool.QueryRow(context.Background(), `SELECT id FROM wall_images WHERE wall_id=$1`, shared.PgUUID(e.wallID)).Scan(&imageID); err != nil {
		t.Fatal(err)
	}
	holdIDs := []pgtype.UUID{shared.PgUUID(e.holdIDs[0]), shared.PgUUID(e.holdIDs[1])}
	routeIDs := make([]string, 0, 101)
	for i := 0; i < 101; i++ {
		route, err := e.q.CreateRoute(context.Background(), generated.CreateRouteParams{
			WallID: shared.PgUUID(e.wallID), WallImageID: imageID, CreatedBy: shared.PgUUID(e.creatorID),
			Name: fmt.Sprintf("Circuit route %d", i), HoldIds: holdIDs, HoldRoles: []byte(`{}`),
			Status: "published", Tags: []string{},
		})
		if err != nil {
			t.Fatal(err)
		}
		routeIDs = append(routeIDs, uuid.UUID(route.ID.Bytes).String())
	}
	c := circuitCreate(t, e, e.token, "Limit", false, routeIDs[:100])
	if r := circuitRequest(e, http.MethodPost, c.ID+"/routes", e.token, `{}`); r.Code != http.StatusBadRequest {
		t.Fatalf("append without route_id status %d", r.Code)
	}
	if r := circuitRequest(e, http.MethodPut, c.ID+"/routes", e.token, `{}`); r.Code != http.StatusBadRequest {
		t.Fatalf("replace without route_ids status %d", r.Code)
	}
	if r := circuitRequest(e, http.MethodPost, c.ID+"/routes", e.token, fmt.Sprintf(`{"route_id":%q}`, routeIDs[0])); r.Code != http.StatusOK {
		t.Fatalf("idempotent duplicate append at limit: %d %s", r.Code, r.Body)
	}
	if r := circuitRequest(e, http.MethodPost, c.ID+"/routes", e.token, fmt.Sprintf(`{"route_id":%q}`, routeIDs[100])); r.Code != http.StatusBadRequest {
		t.Fatalf("append beyond 100 routes status %d", r.Code)
	}
	got := circuitRequest(e, http.MethodGet, c.ID, e.token, "")
	var after circuitHTTP
	if got.Code != http.StatusOK || json.Unmarshal(got.Body.Bytes(), &after) != nil || len(after.RouteIDs) != 100 {
		t.Fatalf("route limit should retain 100 routes: status=%d count=%d body=%s", got.Code, len(after.RouteIDs), got.Body)
	}
	var otherID uuid.UUID
	if err := e.pool.QueryRow(context.Background(), `SELECT id FROM users WHERE email='route-other@example.com'`).Scan(&otherID); err != nil {
		t.Fatal(err)
	}
	if _, err := e.pool.Exec(context.Background(), `UPDATE routes SET status='draft',created_by=$2 WHERE id=$1`, uuid.MustParse(routeIDs[0]), otherID); err != nil {
		t.Fatal(err)
	}
	if r := circuitRequest(e, http.MethodPost, c.ID+"/routes", e.token, fmt.Sprintf(`{"route_id":%q}`, routeIDs[100])); r.Code != http.StatusBadRequest {
		t.Fatalf("hidden route must count toward append limit: %d %s", r.Code, r.Body)
	}
	replacement := append(append([]string(nil), routeIDs[1:100]...), routeIDs[100])
	body, err := json.Marshal(map[string][]string{"route_ids": replacement})
	if err != nil {
		t.Fatal(err)
	}
	if r := circuitRequest(e, http.MethodPut, c.ID+"/routes", e.token, string(body)); r.Code != http.StatusBadRequest {
		t.Fatalf("hidden route must count toward replacement limit: %d %s", r.Code, r.Body)
	}
	if _, err := e.pool.Exec(context.Background(), `UPDATE routes SET status='published' WHERE id=$1`, uuid.MustParse(routeIDs[0])); err != nil {
		t.Fatal(err)
	}
	got = circuitRequest(e, http.MethodGet, c.ID, e.token, "")
	if got.Code != http.StatusOK || json.Unmarshal(got.Body.Bytes(), &after) != nil || len(after.RouteIDs) != 100 || after.RouteIDs[0] != routeIDs[0] {
		t.Fatalf("failed replacement must preserve hidden route rows: status=%d count=%d body=%s", got.Code, len(after.RouteIDs), got.Body)
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

func TestCircuitReplacementPreservesNewlyHiddenRoutes(t *testing.T) {
	e := newRouteTestEnv(t)
	otherBody := fmt.Sprintf(`{"name":"Other published route","hold_ids":[%q,%q],"status":"published"}`, e.holdIDs[0], e.holdIDs[1])
	otherResponse := e.request(http.MethodPost, "", e.other, otherBody)
	if otherResponse.Code != http.StatusCreated {
		t.Fatalf("other user's published route: %d %s", otherResponse.Code, otherResponse.Body)
	}
	var otherRoute routeTestResponse
	if err := json.Unmarshal(otherResponse.Body.Bytes(), &otherRoute); err != nil {
		t.Fatal(err)
	}
	ownRoute := e.create(t, "", "published")
	otherOwnRoute := e.create(t, ",\"grade\":\"V2\"", "published")
	c := circuitCreate(t, e, e.token, "Preserve hidden route", false, []string{ownRoute.ID, otherOwnRoute.ID, otherRoute.ID})

	if _, err := e.pool.Exec(context.Background(), `UPDATE routes SET status='draft' WHERE id=$1`, uuid.MustParse(otherRoute.ID)); err != nil {
		t.Fatal(err)
	}
	visible := circuitRequest(e, http.MethodGet, c.ID, e.token, "")
	var beforeReplace circuitHTTP
	if visible.Code != http.StatusOK || json.Unmarshal(visible.Body.Bytes(), &beforeReplace) != nil || len(beforeReplace.RouteIDs) != 2 || beforeReplace.RouteIDs[0] != ownRoute.ID || beforeReplace.RouteIDs[1] != otherOwnRoute.ID {
		t.Fatalf("newly hidden route should not be listed: status=%d body=%s", visible.Code, visible.Body)
	}

	replaced := circuitRequest(e, http.MethodPut, c.ID+"/routes", e.token, fmt.Sprintf(`{"route_ids":[%q]}`, ownRoute.ID))
	if replaced.Code != http.StatusOK {
		t.Fatalf("replace visible route order: %d %s", replaced.Code, replaced.Body)
	}
	if _, err := e.pool.Exec(context.Background(), `UPDATE routes SET status='published' WHERE id=$1`, uuid.MustParse(otherRoute.ID)); err != nil {
		t.Fatal(err)
	}
	after := circuitRequest(e, http.MethodGet, c.ID, e.token, "")
	var restored circuitHTTP
	if after.Code != http.StatusOK || json.Unmarshal(after.Body.Bytes(), &restored) != nil {
		t.Fatalf("circuit after republishing hidden route: %d %s", after.Code, after.Body)
	}
	if len(restored.RouteIDs) != 2 || restored.RouteIDs[0] != ownRoute.ID || restored.RouteIDs[1] != otherRoute.ID {
		t.Fatalf("replacement discarded or misplaced hidden route: %#v", restored.RouteIDs)
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

func TestCircuitAdminCanDeleteVisibleSharedCircuit(t *testing.T) {
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
	private := circuitCreate(t, e, e.token, "Private from admin", false, nil)
	if r := circuitRequest(e, http.MethodDelete, private.ID, tokens.AccessToken, ""); r.Code != http.StatusNotFound {
		t.Fatalf("private circuit must remain hidden from admins: %d %s", r.Code, r.Body)
	}
	shared := circuitCreate(t, e, e.token, "Shared for admin", true, nil)
	if r := circuitRequest(e, http.MethodDelete, shared.ID, tokens.AccessToken, ""); r.Code != http.StatusNoContent {
		t.Fatalf("admin delete of visible shared circuit: %d %s", r.Code, r.Body)
	}
}

func TestCircuitConcurrentAppendsSerialize(t *testing.T) {
	e := newRouteTestEnv(t)
	first := e.create(t, "", "published")
	second := e.create(t, ",\"grade\":\"V2\"", "published")
	c := circuitCreate(t, e, e.token, "Concurrent", false, nil)

	start := make(chan struct{})
	statuses := make([]int, 2)
	var wg sync.WaitGroup
	for i, routeID := range []string{first.ID, second.ID} {
		wg.Add(1)
		go func(index int, routeID string) {
			defer wg.Done()
			<-start
			body := fmt.Sprintf(`{"route_id":%q}`, routeID)
			statuses[index] = circuitRequest(e, http.MethodPost, c.ID+"/routes", e.token, body).Code
		}(i, routeID)
	}
	close(start)
	wg.Wait()
	for _, status := range statuses {
		if status != http.StatusOK {
			t.Fatalf("concurrent append status %d, want 200", status)
		}
	}
	got := circuitRequest(e, http.MethodGet, c.ID, e.token, "")
	var saved circuitHTTP
	if got.Code != http.StatusOK || json.Unmarshal(got.Body.Bytes(), &saved) != nil || len(saved.RouteIDs) != 2 {
		t.Fatalf("concurrent appends should both persist: status=%d body=%s", got.Code, got.Body)
	}
	if saved.RouteIDs[0] == saved.RouteIDs[1] {
		t.Fatalf("concurrent appends duplicated a route: %#v", saved.RouteIDs)
	}
}
