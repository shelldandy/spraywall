package route_test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/bowlinedandy/spraywall/server/db/generated"
	"github.com/bowlinedandy/spraywall/server/internal/shared"
)

func (e *routeTestEnv) requestSubpath(method, routeID, suffix, token, body string) *httptest.ResponseRecorder {
	path := e.path(routeID) + suffix
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	e.router.ServeHTTP(rec, req)
	return rec
}

func TestClimbLogsProgressRatingAndPrivateHistory(t *testing.T) {
	e := newRouteTestEnv(t)
	rt := e.create(t, `,"grade":"V4"`, "published")
	for _, body := range []string{
		`{"outcome":"attempt","climbed_on":"2025-02-02","notes":"first try"}`,
		`{"outcome":"send","climbed_on":"2025-02-03"}`,
		`{"outcome":"send","climbed_on":"2025-02-04","notes":"repeat"}`,
	} {
		if rec := e.requestSubpath(http.MethodPost, rt.ID, "/logs", e.token, body); rec.Code != http.StatusCreated {
			t.Fatalf("create log: %d %s", rec.Code, rec.Body)
		}
	}
	list := e.requestSubpath(http.MethodGet, rt.ID, "/logs", e.token, "")
	var logs []map[string]any
	if list.Code != http.StatusOK || json.Unmarshal(list.Body.Bytes(), &logs) != nil || len(logs) != 3 {
		t.Fatalf("history: %d %s", list.Code, list.Body)
	}
	wrongWall := strings.Replace(e.path(rt.ID), e.wallID.String(), uuid.NewString(), 1) + "/logs"
	wrongWallReq := httptest.NewRequest(http.MethodGet, wrongWall, nil)
	wrongWallReq.Header.Set("Authorization", "Bearer "+e.token)
	wrongWallRec := httptest.NewRecorder()
	e.router.ServeHTTP(wrongWallRec, wrongWallReq)
	if wrongWallRec.Code != http.StatusNotFound {
		t.Fatalf("mismatched wall should not resolve route: %d %s", wrongWallRec.Code, wrongWallRec.Body)
	}
	other := e.requestSubpath(http.MethodGet, rt.ID, "/logs", e.other, "")
	var otherLogs []any
	if other.Code != http.StatusOK || json.Unmarshal(other.Body.Bytes(), &otherLogs) != nil || len(otherLogs) != 0 {
		t.Fatalf("other member history should be empty: %d %s", other.Code, other.Body)
	}
	detail := e.request(http.MethodGet, rt.ID, e.token, "")
	var summary map[string]any
	if detail.Code != http.StatusOK || json.Unmarshal(detail.Body.Bytes(), &summary) != nil {
		t.Fatalf("detail: %d %s", detail.Code, detail.Body)
	}
	if summary["send_count"] != float64(2) || summary["progress"] != "sent" || summary["has_sent"] != true {
		t.Fatalf("unexpected climb summary: %#v", summary)
	}
	logbookReq := httptest.NewRequest(http.MethodGet, "/users/me/logbook", nil)
	logbookReq.Header.Set("Authorization", "Bearer "+e.token)
	logbookRec := httptest.NewRecorder()
	e.router.ServeHTTP(logbookRec, logbookReq)
	var logbook []map[string]any
	if logbookRec.Code != http.StatusOK || json.Unmarshal(logbookRec.Body.Bytes(), &logbook) != nil || len(logbook) != 3 {
		t.Fatalf("logbook response: %d %s", logbookRec.Code, logbookRec.Body)
	}
	if logbook[0]["climbed_on"] != "2025-02-04" || logbook[0]["outcome"] != "send" || logbook[0]["wall_id"] == nil || logbook[0]["gym_slug"] != "route-test" {
		t.Fatalf("logbook ordering/navigation data: %#v", logbook[0])
	}

	for _, vote := range []struct {
		token string
		stars int
	}{{e.token, 1}, {e.other, 5}} {
		body := fmt.Sprintf(`{"stars":%d}`, vote.stars)
		if rec := e.requestSubpath(http.MethodPut, rt.ID, "/rating", vote.token, body); rec.Code != http.StatusOK {
			t.Fatalf("rate route: %d %s", rec.Code, rec.Body)
		}
	}
	if rec := e.requestSubpath(http.MethodPut, rt.ID, "/rating", e.other, `{"stars":4}`); rec.Code != http.StatusOK {
		t.Fatalf("update rating: %d %s", rec.Code, rec.Body)
	}
	detail = e.request(http.MethodGet, rt.ID, e.token, "")
	if json.Unmarshal(detail.Body.Bytes(), &summary) != nil || summary["rating_average"] != float64(2.5) || summary["rating_count"] != float64(2) || summary["my_rating"] != float64(1) {
		t.Fatalf("rating summary should have one vote per user: %s", detail.Body)
	}
	if rec := e.requestSubpath(http.MethodPut, rt.ID, "/rating", e.other, `{"stars":0}`); rec.Code != http.StatusBadRequest {
		t.Fatalf("invalid stars status %d: %s", rec.Code, rec.Body)
	}
	if rec := e.requestSubpath(http.MethodDelete, rt.ID, "/rating", e.other, ""); rec.Code != http.StatusNoContent {
		t.Fatalf("remove rating: %d %s", rec.Code, rec.Body)
	}
	detail = e.request(http.MethodGet, rt.ID, e.token, "")
	if json.Unmarshal(detail.Body.Bytes(), &summary) != nil || summary["rating_average"] != float64(1) || summary["rating_count"] != float64(1) {
		t.Fatalf("rating removal summary: %s", detail.Body)
	}
	if rec := e.requestSubpath(http.MethodDelete, rt.ID, "/rating", e.token, ""); rec.Code != http.StatusNoContent {
		t.Fatalf("clear last rating: %d %s", rec.Code, rec.Body)
	}
	detail = e.request(http.MethodGet, rt.ID, e.token, "")
	if json.Unmarshal(detail.Body.Bytes(), &summary) != nil || summary["rating_average"] != nil || summary["rating_count"] != float64(0) {
		t.Fatalf("unrated summary: %s", detail.Body)
	}
}

func TestFlashChronologyEditsAndGuardedLegacyDelete(t *testing.T) {
	e := newRouteTestEnv(t)
	rt := e.create(t, "", "published")
	flash := e.requestSubpath(http.MethodPost, rt.ID, "/logs", e.token, `{"outcome":"flash","climbed_on":"2025-01-02"}`)
	if flash.Code != http.StatusCreated {
		t.Fatalf("flash: %d %s", flash.Code, flash.Body)
	}
	detail := e.request(http.MethodGet, rt.ID, e.token, "")
	var flashSummary map[string]any
	if detail.Code != http.StatusOK || json.Unmarshal(detail.Body.Bytes(), &flashSummary) != nil || flashSummary["has_flashed"] != true || flashSummary["send_count"] != float64(1) {
		t.Fatalf("flash summary: %d %s", detail.Code, detail.Body)
	}
	attempt := e.requestSubpath(http.MethodPost, rt.ID, "/logs", e.token, `{"outcome":"attempt","climbed_on":"2025-01-01"}`)
	if attempt.Code != http.StatusConflict || !strings.Contains(attempt.Body.String(), "Flash") {
		t.Fatalf("backdated attempt status %d: %s", attempt.Code, attempt.Body)
	}
	attempt = e.requestSubpath(http.MethodPost, rt.ID, "/logs", e.token, `{"outcome":"attempt","climbed_on":"2025-01-03"}`)
	if attempt.Code != http.StatusCreated {
		t.Fatalf("later attempt: %d %s", attempt.Code, attempt.Body)
	}
	var attemptLog map[string]any
	if err := json.Unmarshal(attempt.Body.Bytes(), &attemptLog); err != nil {
		t.Fatal(err)
	}
	id := attemptLog["id"].(string)
	foreign := e.requestSubpath(http.MethodPut, rt.ID, "/logs/"+id, e.other, `{"outcome":"send","climbed_on":"2025-01-04"}`)
	if foreign.Code != http.StatusForbidden {
		t.Fatalf("foreign edit status %d: %s", foreign.Code, foreign.Body)
	}
	correct := e.requestSubpath(http.MethodPut, rt.ID, "/logs/"+id, e.token, `{"outcome":"send","climbed_on":"2025-01-04"}`)
	if correct.Code != http.StatusOK {
		t.Fatalf("edit log: %d %s", correct.Code, correct.Body)
	}

	legacy := e.requestSubpath(http.MethodPost, rt.ID, "/sends", e.token, `{"attempts":3,"notes":"legacy adapter"}`)
	if legacy.Code != http.StatusCreated || !strings.Contains(legacy.Body.String(), "sent_at") {
		t.Fatalf("legacy send response: %d %s", legacy.Code, legacy.Body)
	}
	remove := e.requestSubpath(http.MethodDelete, rt.ID, "/sends/me", e.token, "")
	if remove.Code != http.StatusConflict {
		t.Fatalf("ambiguous legacy deletion should conflict: %d %s", remove.Code, remove.Body)
	}
	if rec := e.requestSubpath(http.MethodDelete, rt.ID, "/logs/"+id, e.token, ""); rec.Code != http.StatusNoContent {
		t.Fatalf("delete one entry: %d %s", rec.Code, rec.Body)
	}
}

func TestClimbLogMigrationPreservesLegacySendData(t *testing.T) {
	e := newRouteTestEnv(t)
	rt := e.create(t, "", "published")
	_, file, _, _ := runtime.Caller(0)
	migrationPath := filepath.Join(filepath.Dir(file), "..", "..", "db", "migrations", "0015_climb_logs_ratings.sql")
	migration, err := os.ReadFile(migrationPath)
	if err != nil {
		t.Fatal(err)
	}
	_, down, ok := strings.Cut(string(migration), "-- +goose Down")
	if !ok {
		t.Fatal("missing Down migration")
	}
	if _, err := e.pool.Exec(t.Context(), down); err != nil {
		t.Fatalf("revert empty feature migration: %v", err)
	}
	var userID string
	if err := e.pool.QueryRow(t.Context(), `SELECT id::text FROM users WHERE email='route-creator@example.com'`).Scan(&userID); err != nil {
		t.Fatal(err)
	}
	var oldID string
	const timestamp = "2024-08-09 02:30:00+00"
	if err := e.pool.QueryRow(t.Context(), `INSERT INTO sends(route_id,user_id,sent_at,attempts,notes) VALUES($1,$2,$3::timestamptz,3,'legacy note') RETURNING id::text`, rt.ID, userID, timestamp).Scan(&oldID); err != nil {
		t.Fatal(err)
	}
	up, _, _ := strings.Cut(string(migration), "-- +goose Down")
	up = strings.ReplaceAll(strings.TrimPrefix(up, "-- +goose Up"), "-- +goose StatementBegin", "")
	up = strings.ReplaceAll(up, "-- +goose StatementEnd", "")
	if _, err := e.pool.Exec(t.Context(), up); err != nil {
		t.Fatalf("apply feature migration over legacy send: %v", err)
	}
	var id, date, outcome, notes string
	var loggedAt time.Time
	var attempts int32
	if err := e.pool.QueryRow(t.Context(), `SELECT id::text,logged_at,climbed_on::text,outcome,attempts,notes FROM climb_logs WHERE id=$1`, oldID).Scan(&id, &loggedAt, &date, &outcome, &attempts, &notes); err != nil {
		t.Fatal(err)
	}
	if id != oldID || loggedAt.UTC().Format(time.RFC3339) != "2024-08-09T02:30:00Z" || date != "2024-08-09" || outcome != "send" || attempts != 3 || notes != "legacy note" {
		t.Fatalf("migration changed legacy send data: id=%s timestamp=%s date=%s outcome=%s attempts=%d notes=%q", id, loggedAt, date, outcome, attempts, notes)
	}
}

func TestClimbLogMigrationDownRefusesUnrepresentableHistory(t *testing.T) {
	e := newRouteTestEnv(t)
	rt := e.create(t, "", "published")
	for _, body := range []string{`{"outcome":"attempt","climbed_on":"2025-01-01"}`, `{"outcome":"send","climbed_on":"2025-01-02"}`} {
		if rec := e.requestSubpath(http.MethodPost, rt.ID, "/logs", e.token, body); rec.Code != http.StatusCreated {
			t.Fatalf("create history: %d %s", rec.Code, rec.Body)
		}
	}
	_, file, _, _ := runtime.Caller(0)
	migrationPath := filepath.Join(filepath.Dir(file), "..", "..", "db", "migrations", "0015_climb_logs_ratings.sql")
	migration, err := os.ReadFile(migrationPath)
	if err != nil {
		t.Fatal(err)
	}
	_, down, ok := strings.Cut(string(migration), "-- +goose Down")
	if !ok {
		t.Fatal("missing Down migration")
	}
	if _, err := e.pool.Exec(t.Context(), down); err == nil {
		t.Fatal("down migration unexpectedly erased unrepresentable activity")
	}
	var count int
	if err := e.pool.QueryRow(t.Context(), `SELECT count(*) FROM climb_logs`).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 2 {
		t.Fatalf("down migration changed history: retained %d rows", count)
	}
}

func TestLogInputDraftAndResetRestrictions(t *testing.T) {
	e := newRouteTestEnv(t)
	rt := e.create(t, "", "published")
	draft := e.create(t, "", "draft")
	if rec := e.requestSubpath(http.MethodPost, draft.ID, "/logs", e.token, `{"outcome":"attempt","climbed_on":"2025-01-01"}`); rec.Code != http.StatusBadRequest {
		t.Fatalf("draft log status %d: %s", rec.Code, rec.Body)
	}
	if rec := e.requestSubpath(http.MethodPut, draft.ID, "/rating", e.token, `{"stars":4}`); rec.Code != http.StatusBadRequest {
		t.Fatalf("draft rating status %d: %s", rec.Code, rec.Body)
	}
	for _, body := range []string{`{"outcome":"wrong","climbed_on":"2025-01-01"}`, `{"outcome":"attempt","climbed_on":"01/02/2025"}`} {
		if rec := e.requestSubpath(http.MethodPost, rt.ID, "/logs", e.token, body); rec.Code != http.StatusBadRequest {
			t.Fatalf("invalid log %s: %d %s", body, rec.Code, rec.Body)
		}
	}
	created := e.requestSubpath(http.MethodPost, rt.ID, "/logs", e.token, `{"outcome":"attempt","climbed_on":"2025-01-01"}`)
	if created.Code != http.StatusCreated {
		t.Fatalf("valid log: %d %s", created.Code, created.Body)
	}
	var entry map[string]any
	if err := json.Unmarshal(created.Body.Bytes(), &entry); err != nil {
		t.Fatal(err)
	}
	id := entry["id"].(string)
	legacySend := e.requestSubpath(http.MethodPost, rt.ID, "/sends", e.token, `{"attempts":2}`)
	if legacySend.Code != http.StatusCreated || !strings.Contains(legacySend.Body.String(), "sent_at") {
		t.Fatalf("legacy send: %d %s", legacySend.Code, legacySend.Body)
	}
	if rec := e.requestSubpath(http.MethodDelete, rt.ID, "/sends/me", e.token, ""); rec.Code != http.StatusNoContent {
		t.Fatalf("unambiguous legacy delete: %d %s", rec.Code, rec.Body)
	}
	if _, err := e.q.CreateWallImage(t.Context(), generated.CreateWallImageParams{WallID: shared.PgUUID(e.wallID), StorageKey: "reset-image"}); err != nil {
		t.Fatal(err)
	}
	if rec := e.requestSubpath(http.MethodPost, rt.ID, "/logs", e.token, `{"outcome":"send","climbed_on":"2025-01-02"}`); rec.Code != http.StatusBadRequest {
		t.Fatalf("reset new log status %d: %s", rec.Code, rec.Body)
	}
	if rec := e.requestSubpath(http.MethodPut, rt.ID, "/logs/"+id, e.token, `{"outcome":"send","climbed_on":"2025-01-02"}`); rec.Code != http.StatusOK {
		t.Fatalf("reset correction status %d: %s", rec.Code, rec.Body)
	}
	if rec := e.requestSubpath(http.MethodPut, rt.ID, "/rating", e.other, `{"stars":3}`); rec.Code != http.StatusOK {
		t.Fatalf("reset rating status %d: %s", rec.Code, rec.Body)
	}
	if rec := e.requestSubpath(http.MethodDelete, rt.ID, "/logs/"+id, e.token, ""); rec.Code != http.StatusNoContent {
		t.Fatalf("reset delete status %d: %s", rec.Code, rec.Body)
	}
}

func TestConcurrentFlashWritesSerializeByUser(t *testing.T) {
	e := newRouteTestEnv(t)
	rt := e.create(t, "", "published")
	start := make(chan struct{})
	codes := make(chan int, 2)
	for i := 0; i < 2; i++ {
		go func() {
			<-start
			rec := e.requestSubpath(http.MethodPost, rt.ID, "/logs", e.token, `{"outcome":"flash","climbed_on":"2025-01-01"}`)
			codes <- rec.Code
		}()
	}
	close(start)
	first, second := <-codes, <-codes
	if !((first == http.StatusCreated && second == http.StatusConflict) || (second == http.StatusCreated && first == http.StatusConflict)) {
		t.Fatalf("concurrent write statuses = %d, %d", first, second)
	}
	var count int
	if err := e.pool.QueryRow(t.Context(), `SELECT count(*) FROM climb_logs WHERE route_id=$1 AND outcome='flash'`, uuid.MustParse(rt.ID)).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("concurrent writes left %d Flash rows", count)
	}
}
