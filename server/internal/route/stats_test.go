package route_test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/bowlinedandy/spraywall/server/internal/shared"
)

type wallStatsResponse struct {
	ImageID *string `json:"image_id"`
	Totals  struct {
		Climbs      int `json:"climbs"`
		Ascents     int `json:"ascents"`
		Sends       int `json:"sends"`
		Flashes     int `json:"flashes"`
		Climbers    int `json:"climbers"`
		Holds       int `json:"holds"`
		UnusedHolds int `json:"unused_holds"`
	} `json:"totals"`
	Holds []struct {
		HoldID  string `json:"hold_id"`
		Climbs  int    `json:"climbs"`
		Ascents int    `json:"ascents"`
		Start   int    `json:"start"`
		Finish  int    `json:"finish"`
		Foot    int    `json:"foot"`
	} `json:"holds"`
	Grades []struct {
		Grade   *string `json:"grade"`
		Climbs  int     `json:"climbs"`
		Sends   int     `json:"sends"`
		Flashes int     `json:"flashes"`
	} `json:"grades"`
	Weekly []struct {
		WeekStart string `json:"week_start"`
		Ascents   int    `json:"ascents"`
		Climbers  int    `json:"climbers"`
	} `json:"weekly"`
	MostRepeated []struct {
		RouteID string `json:"route_id"`
		Sends   int    `json:"sends"`
	} `json:"most_repeated"`
	TopRated []struct {
		RouteID       string  `json:"route_id"`
		RatingAverage float64 `json:"rating_average"`
		RatingCount   int     `json:"rating_count"`
	} `json:"top_rated"`
	Unsent []struct {
		RouteID string `json:"route_id"`
	} `json:"unsent"`
	Setters []struct {
		UserID string `json:"user_id"`
		Climbs int    `json:"climbs"`
	} `json:"setters"`
}

func TestWallStatsIncludesActivePublishedRouteAndHoldStatistics(t *testing.T) {
	e := newRouteTestEnv(t)
	e.router.Get("/walls/{wallId}/stats", e.handler.WallStats)
	var unused uuid.UUID
	if err := e.pool.QueryRow(t.Context(), `INSERT INTO holds(wall_image_id,bbox,confidence) SELECT wall_image_id,'{}',1 FROM holds WHERE id=$1 RETURNING id`, shared.PgUUID(e.holdIDs[0])).Scan(&unused); err != nil {
		t.Fatal(err)
	}
	imageID, err := e.q.GetActiveWallImage(t.Context(), shared.PgUUID(e.wallID))
	if err != nil {
		t.Fatal(err)
	}
	sharedHold := e.holdIDs[0]
	var otherID uuid.UUID
	if err := e.pool.QueryRow(t.Context(), `SELECT id FROM users WHERE email='route-other@example.com'`).Scan(&otherID); err != nil {
		t.Fatal(err)
	}
	var routeA, routeB uuid.UUID
	rolesA := fmt.Sprintf(`{"start":[%q],"finish":[%q],"foot":[%q]}`, sharedHold, e.holdIDs[1], sharedHold)
	for _, item := range []struct {
		name, grade string
		createdBy   uuid.UUID
		holdIDs     []uuid.UUID
		roles       string
		dst         *uuid.UUID
	}{
		{"First", "V3", e.creatorID, []uuid.UUID{sharedHold, e.holdIDs[1]}, rolesA, &routeA},
		{"Second", "V5", otherID, []uuid.UUID{sharedHold}, fmt.Sprintf(`{"start":[%q]}`, sharedHold), &routeB},
	} {
		if err := e.pool.QueryRow(t.Context(), `INSERT INTO routes(wall_id,wall_image_id,created_by,name,grade,hold_ids,hold_roles,status,tags) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,'published','{}') RETURNING id`, shared.PgUUID(e.wallID), imageID.ID, shared.PgUUID(item.createdBy), item.name, item.grade, item.holdIDs, item.roles).Scan(item.dst); err != nil {
			t.Fatal(err)
		}
	}
	// A draft on the same active image must not contribute to any section.
	if _, err := e.pool.Exec(t.Context(), `INSERT INTO routes(wall_id,wall_image_id,created_by,name,hold_ids,status,tags) VALUES($1,$2,$3,'Draft',$4,'draft','{}')`, shared.PgUUID(e.wallID), imageID.ID, shared.PgUUID(e.creatorID), []uuid.UUID{sharedHold}); err != nil {
		t.Fatal(err)
	}
	for _, rating := range []struct {
		route uuid.UUID
		user  uuid.UUID
		stars int
	}{{routeA, e.creatorID, 5}, {routeA, otherID, 3}, {routeB, e.creatorID, 4}, {routeB, otherID, 5}} {
		if _, err := e.pool.Exec(t.Context(), `INSERT INTO route_ratings(route_id,user_id,stars) VALUES($1,$2,$3)`, shared.PgUUID(rating.route), shared.PgUUID(rating.user), rating.stars); err != nil {
			t.Fatal(err)
		}
	}
	thisWeek := time.Now().UTC().Format("2006-01-02")
	for _, item := range []struct {
		route   uuid.UUID
		user    uuid.UUID
		outcome string
	}{
		{routeA, e.creatorID, "attempt"}, {routeA, e.creatorID, "send"}, {routeA, otherID, "send"},
		{routeA, otherID, "flash"}, {routeB, e.creatorID, "attempt"},
	} {
		if _, err := e.pool.Exec(t.Context(), `INSERT INTO climb_logs(route_id,user_id,outcome,climbed_on) VALUES($1,$2,$3,$4)`, shared.PgUUID(item.route), shared.PgUUID(item.user), item.outcome, thisWeek); err != nil {
			t.Fatal(err)
		}
	}
	req := httptest.NewRequest(http.MethodGet, fmt.Sprintf("/walls/%s/stats", e.wallID), nil)
	req.Header.Set("Authorization", "Bearer "+e.other)
	rec := httptest.NewRecorder()
	e.router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("stats status %d: %s", rec.Code, rec.Body)
	}
	var stats wallStatsResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &stats); err != nil {
		t.Fatal(err)
	}
	if stats.ImageID == nil || *stats.ImageID != imageID.ID.String() {
		t.Fatalf("image_id = %v", stats.ImageID)
	}
	if got := stats.Totals; got.Climbs != 2 || got.Ascents != 5 || got.Sends != 2 || got.Flashes != 1 || got.Climbers != 2 || got.Holds != 3 || got.UnusedHolds != 1 {
		t.Fatalf("totals = %+v", got)
	}
	if got := stats.Grades; len(got) != 2 || got[0].Grade == nil || *got[0].Grade != "V3" || got[0].Climbs != 1 || got[0].Sends != 2 || got[0].Flashes != 1 || got[1].Grade == nil || *got[1].Grade != "V5" || got[1].Climbs != 1 {
		t.Fatalf("grades = %+v", got)
	}
	if got := stats.MostRepeated; len(got) != 1 || got[0].RouteID != routeA.String() || got[0].Sends != 3 {
		t.Fatalf("most_repeated = %+v", got)
	}
	if got := stats.TopRated; len(got) != 2 || got[0].RouteID != routeB.String() || got[0].RatingAverage != 4.5 || got[0].RatingCount != 2 {
		t.Fatalf("top_rated = %+v", got)
	}
	if got := stats.Unsent; len(got) != 1 || got[0].RouteID != routeB.String() {
		t.Fatalf("unsent = %+v", got)
	}
	if got := stats.Setters; len(got) != 2 || got[0].UserID != e.creatorID.String() || got[0].Climbs != 1 || got[1].UserID != otherID.String() || got[1].Climbs != 1 {
		t.Fatalf("setters = %+v", got)
	}
	if len(stats.Holds) != 3 {
		t.Fatalf("holds length=%d, want 3: %+v", len(stats.Holds), stats.Holds)
	}
	for _, h := range stats.Holds {
		if h.HoldID == unused.String() && (h.Climbs != 0 || h.Ascents != 0 || h.Start != 0 || h.Finish != 0 || h.Foot != 0) {
			t.Fatalf("unused hold stats = %+v", h)
		}
		if h.HoldID == sharedHold.String() && (h.Climbs != 2 || h.Ascents != 5 || h.Start != 2 || h.Foot != 1) {
			t.Fatalf("shared hold stats = %+v", h)
		}
	}
	if len(stats.Weekly) != 12 {
		t.Fatalf("weekly length=%d, want 12", len(stats.Weekly))
	}
	last := stats.Weekly[len(stats.Weekly)-1]
	if last.Ascents != 5 || last.Climbers != 2 {
		t.Fatalf("current week = %+v", last)
	}
}

func TestWallStatsRequireExistingWall(t *testing.T) {
	e := newRouteTestEnv(t)
	e.router.Get("/walls/{wallId}/stats", e.handler.WallStats)
	req := httptest.NewRequest(http.MethodGet, fmt.Sprintf("/walls/%s/stats", uuid.New()), nil)
	req.Header.Set("Authorization", "Bearer "+e.token)
	rec := httptest.NewRecorder()
	e.router.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("missing wall status=%d, want 404: %s", rec.Code, rec.Body)
	}
}

func TestWallStatsWithoutActiveImageReturnsEmptyAggregates(t *testing.T) {
	e := newRouteTestEnv(t)
	e.router.Get("/walls/{wallId}/stats", e.handler.WallStats)
	if _, err := e.pool.Exec(t.Context(), `UPDATE wall_images SET is_active=false WHERE wall_id=$1`, shared.PgUUID(e.wallID)); err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodGet, fmt.Sprintf("/walls/%s/stats", e.wallID), nil)
	req.Header.Set("Authorization", "Bearer "+e.token)
	rec := httptest.NewRecorder()
	e.router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("stats status %d: %s", rec.Code, rec.Body)
	}
	var stats wallStatsResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &stats); err != nil {
		t.Fatal(err)
	}
	if stats.ImageID != nil {
		t.Fatalf("image_id = %v, want null", *stats.ImageID)
	}
	if stats.Totals != (struct {
		Climbs      int `json:"climbs"`
		Ascents     int `json:"ascents"`
		Sends       int `json:"sends"`
		Flashes     int `json:"flashes"`
		Climbers    int `json:"climbers"`
		Holds       int `json:"holds"`
		UnusedHolds int `json:"unused_holds"`
	}{}) {
		t.Fatalf("totals = %+v, want all zeros", stats.Totals)
	}
	if len(stats.Holds) != 0 {
		t.Fatalf("holds = %+v, want empty", stats.Holds)
	}
	if len(stats.Weekly) != 12 {
		t.Fatalf("weekly length=%d, want 12", len(stats.Weekly))
	}
	for _, week := range stats.Weekly {
		if week.Ascents != 0 || week.Climbers != 0 {
			t.Fatalf("week = %+v, want zeros", week)
		}
	}
}
