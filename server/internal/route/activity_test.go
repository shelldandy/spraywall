package route_test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"

	"github.com/google/uuid"

	"github.com/bowlinedandy/spraywall/server/db/generated"
	"github.com/bowlinedandy/spraywall/server/internal/shared"
	"github.com/bowlinedandy/spraywall/server/internal/user"
)

type activityTestPage struct {
	Items []struct {
		ID          string  `json:"id"`
		RouteID     string  `json:"route_id"`
		RouteName   string  `json:"route_name"`
		RouteGrade  *string `json:"route_grade"`
		RouteLegacy bool    `json:"route_is_legacy"`
		Outcome     string  `json:"outcome"`
		ClimbedOn   string  `json:"climbed_on"`
		LoggedAt    string  `json:"logged_at"`
		Notes       *string `json:"notes"`
		Attempts    *int32  `json:"attempts"`
		User        struct {
			ID          string  `json:"id"`
			DisplayName string  `json:"display_name"`
			AvatarURL   *string `json:"avatar_url"`
		} `json:"user"`
	} `json:"items"`
	NextCursor *string `json:"next_cursor"`
}

func activityWallPath(wallID uuid.UUID) string {
	return fmt.Sprintf("/gyms/route-test/walls/%s/activity", wallID)
}

func (e *routeTestEnv) requestWallActivity(wallID uuid.UUID, token, query string) *httptest.ResponseRecorder {
	path := activityWallPath(wallID)
	if query != "" {
		path += "?" + query
	}
	req := httptest.NewRequest(http.MethodGet, path, nil)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	rec := httptest.NewRecorder()
	e.router.ServeHTTP(rec, req)
	return rec
}

func activityPageFrom(t *testing.T, rec *httptest.ResponseRecorder) activityTestPage {
	t.Helper()
	var page activityTestPage
	if rec.Code != http.StatusOK {
		t.Fatalf("activity status %d: %s", rec.Code, rec.Body)
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &page); err != nil {
		t.Fatalf("decode activity: %v: %s", err, rec.Body)
	}
	return page
}

func TestActivityFeedsShareMemberLogsAndScopeRoutes(t *testing.T) {
	e := newRouteTestEnv(t)
	routeA := e.create(t, `,"grade":"V3"`, "published")
	routeB := e.create(t, `,"grade":"V5"`, "published")
	for _, item := range []struct {
		routeID string
		token   string
		body    string
	}{
		{routeA.ID, e.token, `{"outcome":"send","climbed_on":"2025-03-02","notes":"owner note visible"}`},
		{routeA.ID, e.other, `{"outcome":"attempt","climbed_on":"2025-03-01","notes":"member note"}`},
		{routeB.ID, e.token, `{"outcome":"flash","climbed_on":"2025-03-03","notes":"second route"}`},
	} {
		if rec := e.requestSubpath(http.MethodPost, item.routeID, "/logs", item.token, item.body); rec.Code != http.StatusCreated {
			t.Fatalf("create log: %d %s", rec.Code, rec.Body)
		}
	}

	routeRec := e.requestSubpath(http.MethodGet, routeA.ID, "/activity", e.other, "")
	routePage := activityPageFrom(t, routeRec)
	if len(routePage.Items) != 2 || routePage.Items[0].Notes == nil || *routePage.Items[0].Notes != "owner note visible" || routePage.Items[0].User.DisplayName != "Creator" {
		t.Fatalf("route activity should include the owner's notes and identity: %#v", routePage)
	}
	if routePage.Items[0].ClimbedOn != "2025-03-02" || routePage.Items[1].ClimbedOn != "2025-03-01" || routePage.Items[0].RouteID != routeA.ID {
		t.Fatalf("route activity should contain only route A in descending date order: %#v", routePage.Items)
	}

	wallPage := activityPageFrom(t, e.requestWallActivity(e.wallID, e.other, ""))
	if len(wallPage.Items) != 3 || wallPage.Items[0].RouteID != routeB.ID || wallPage.Items[0].Notes == nil || *wallPage.Items[0].Notes != "second route" {
		t.Fatalf("wall activity should include all routes in date order: %#v", wallPage.Items)
	}
	for _, item := range wallPage.Items {
		if item.RouteID != routeA.ID && item.RouteID != routeB.ID {
			t.Fatalf("unexpected route in wall activity: %#v", item)
		}
	}
}

func TestActivityHidesOtherAuthorsDraftsAndAllowsAuthor(t *testing.T) {
	e := newRouteTestEnv(t)
	var otherID uuid.UUID
	if err := e.pool.QueryRow(t.Context(), `SELECT id FROM users WHERE email='route-other@example.com'`).Scan(&otherID); err != nil {
		t.Fatal(err)
	}
	draftID := uuid.New()
	if _, err := e.pool.Exec(t.Context(), `INSERT INTO routes(id,wall_id,wall_image_id,created_by,name,hold_ids,hold_roles,status,tags)
SELECT $1,$2,id,$3,'Private draft',$4,'{}'::jsonb,'draft','{}'::text[] FROM wall_images WHERE wall_id=$2 AND is_active`, shared.PgUUID(draftID), shared.PgUUID(e.wallID), shared.PgUUID(otherID), e.holdIDs); err != nil {
		t.Fatal(err)
	}
	var logID uuid.UUID
	if err := e.pool.QueryRow(t.Context(), `INSERT INTO climb_logs(route_id,user_id,outcome,climbed_on,notes)
VALUES($1,$2,'attempt','2025-03-04','draft note') RETURNING id`, shared.PgUUID(draftID), shared.PgUUID(otherID)).Scan(&logID); err != nil {
		t.Fatal(err)
	}

	wallPage := activityPageFrom(t, e.requestWallActivity(e.wallID, e.token, ""))
	for _, item := range wallPage.Items {
		if item.ID == logID.String() {
			t.Fatal("another member's draft activity was included in the wall feed")
		}
	}
	if rec := e.requestSubpath(http.MethodGet, draftID.String(), "/activity", e.token, ""); rec.Code != http.StatusNotFound {
		t.Fatalf("other member should not resolve draft route: %d %s", rec.Code, rec.Body)
	}
	own := activityPageFrom(t, e.requestSubpath(http.MethodGet, draftID.String(), "/activity", e.other, ""))
	if len(own.Items) != 1 || own.Items[0].ID != logID.String() || own.Items[0].Notes == nil || *own.Items[0].Notes != "draft note" {
		t.Fatalf("draft author should see their own activity: %#v", own.Items)
	}
}

func TestActivityMembershipAndGymScoping(t *testing.T) {
	e := newRouteTestEnv(t)
	rt := e.create(t, "", "published")
	if rec := e.requestSubpath(http.MethodPost, rt.ID, "/logs", e.token, `{"outcome":"send","climbed_on":"2025-03-02"}`); rec.Code != http.StatusCreated {
		t.Fatalf("create log: %d %s", rec.Code, rec.Body)
	}
	stranger, err := e.q.CreateUser(t.Context(), generated.CreateUserParams{Email: "activity-stranger@example.com", DisplayName: "Stranger", Role: generated.UserRoleClimber})
	if err != nil {
		t.Fatal(err)
	}
	auth := user.NewHandler(e.q, routeTestJWTSecret, e.pool, user.Options{})
	strangerTokens, err := auth.IssueTokens(t.Context(), e.q, stranger)
	if err != nil {
		t.Fatal(err)
	}
	if rec := e.requestWallActivity(e.wallID, strangerTokens.AccessToken, ""); rec.Code != http.StatusForbidden {
		t.Fatalf("non-member wall activity status %d: %s", rec.Code, rec.Body)
	}
	if rec := e.requestSubpath(http.MethodGet, rt.ID, "/activity", strangerTokens.AccessToken, ""); rec.Code != http.StatusForbidden {
		t.Fatalf("non-member route activity status %d: %s", rec.Code, rec.Body)
	}

	foreignGym, err := e.q.CreateGym(t.Context(), generated.CreateGymParams{Name: "Foreign gym", Slug: "activity-foreign", OwnerID: shared.PgUUID(e.creatorID)})
	if err != nil {
		t.Fatal(err)
	}
	foreignWall, err := e.q.CreateWall(t.Context(), generated.CreateWallParams{GymID: foreignGym.ID, Name: "Foreign wall"})
	if err != nil {
		t.Fatal(err)
	}
	foreignImage, err := e.q.CreateWallImage(t.Context(), generated.CreateWallImageParams{WallID: foreignWall.ID, StorageKey: "foreign-image"})
	if err != nil {
		t.Fatal(err)
	}
	foreignHolds := make([]uuid.UUID, 2)
	for i := range foreignHolds {
		hold, err := e.q.CreateHold(t.Context(), generated.CreateHoldParams{WallImageID: foreignImage.ID, Bbox: []byte(`{}`), Confidence: 1})
		if err != nil {
			t.Fatal(err)
		}
		foreignHolds[i] = uuid.UUID(hold.ID.Bytes)
	}
	var foreignRouteID uuid.UUID
	if err := e.pool.QueryRow(t.Context(), `INSERT INTO routes(wall_id,wall_image_id,created_by,name,hold_ids,hold_roles,status,tags)
VALUES($1,$2,$3,'Foreign route',$4,'{}'::jsonb,'published','{}'::text[]) RETURNING id`, foreignWall.ID, foreignImage.ID, shared.PgUUID(e.creatorID), foreignHolds).Scan(&foreignRouteID); err != nil {
		t.Fatal(err)
	}
	wrongWall := e.requestWallActivity(uuid.UUID(foreignWall.ID.Bytes), e.token, "")
	if wrongWall.Code != http.StatusNotFound {
		t.Fatalf("wall from another gym should be 404: %d %s", wrongWall.Code, wrongWall.Body)
	}
	wrongRouteReq := httptest.NewRequest(http.MethodGet, fmt.Sprintf("/gyms/route-test/walls/%s/routes/%s/activity", foreignWall.ID.String(), foreignRouteID), nil)
	wrongRouteReq.Header.Set("Authorization", "Bearer "+e.token)
	wrongRoute := httptest.NewRecorder()
	e.router.ServeHTTP(wrongRoute, wrongRouteReq)
	if wrongRoute.Code != http.StatusNotFound {
		t.Fatalf("route from another gym should be 404: %d %s", wrongRoute.Code, wrongRoute.Body)
	}
}

func TestActivityPaginationUsesDisjointDescendingPages(t *testing.T) {
	e := newRouteTestEnv(t)
	rt := e.create(t, "", "published")
	for _, date := range []string{"2025-04-01", "2025-04-03", "2025-04-02"} {
		body := fmt.Sprintf(`{"outcome":"send","climbed_on":%q}`, date)
		if rec := e.requestSubpath(http.MethodPost, rt.ID, "/logs", e.token, body); rec.Code != http.StatusCreated {
			t.Fatalf("create log: %d %s", rec.Code, rec.Body)
		}
	}

	first := activityPageFrom(t, e.requestWallActivity(e.wallID, e.other, "limit=2"))
	if len(first.Items) != 2 || first.NextCursor == nil || first.Items[0].ClimbedOn != "2025-04-03" || first.Items[1].ClimbedOn != "2025-04-02" {
		t.Fatalf("unexpected first activity page: %#v", first)
	}
	second := activityPageFrom(t, e.requestWallActivity(e.wallID, e.other, "limit=2&cursor="+url.QueryEscape(*first.NextCursor)))
	if len(second.Items) != 1 || second.NextCursor != nil || second.Items[0].ClimbedOn != "2025-04-01" {
		t.Fatalf("unexpected last activity page: %#v", second)
	}
	seen := map[string]bool{}
	for _, item := range append(first.Items, second.Items...) {
		if seen[item.ID] {
			t.Fatalf("activity entry repeated across pages: %s", item.ID)
		}
		seen[item.ID] = true
	}
	if len(seen) != 3 {
		t.Fatalf("pagination returned %d unique entries, want 3", len(seen))
	}
	if rec := e.requestWallActivity(e.wallID, e.other, "cursor=not-a-cursor"); rec.Code != http.StatusBadRequest {
		t.Fatalf("invalid cursor status %d: %s", rec.Code, rec.Body)
	}
	if rec := e.requestWallActivity(e.wallID, e.other, "limit=0"); rec.Code != http.StatusBadRequest {
		t.Fatalf("invalid limit status %d: %s", rec.Code, rec.Body)
	}
}
