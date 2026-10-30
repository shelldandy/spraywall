package route

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"sort"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/bowlinedandy/spraywall/server/db/generated"
	"github.com/bowlinedandy/spraywall/server/internal/shared"
	"github.com/bowlinedandy/spraywall/server/internal/user"
)

type txBeginner interface {
	Begin(context.Context) (pgx.Tx, error)
}

type climbLog struct {
	ID        string    `json:"id"`
	RouteID   string    `json:"route_id"`
	Outcome   string    `json:"outcome"`
	ClimbedOn string    `json:"climbed_on"`
	LoggedAt  time.Time `json:"logged_at"`
	Notes     *string   `json:"notes"`
	Attempts  *int32    `json:"attempts,omitempty"`
}

type logInput struct {
	Outcome   string  `json:"outcome"`
	ClimbedOn string  `json:"climbed_on"`
	Notes     *string `json:"notes"`
	Attempts  *int32  `json:"attempts,omitempty"`
}

type routeScope struct {
	route            generated.Route
	legacy           bool
	activeImage      generated.WallImage
	activeImageFound bool
}

func (h *Handler) scopedRoute(w http.ResponseWriter, r *http.Request) (routeScope, bool) {
	gym, _, err := h.requireGymMember(w, r)
	if err != nil {
		return routeScope{}, false
	}
	wallID, err := parseWallID(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid wall id")
		return routeScope{}, false
	}
	routeID, err := parseRouteID(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid route id")
		return routeScope{}, false
	}
	rt, err := h.queries.GetRouteByID(r.Context(), shared.PgUUID(routeID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, http.StatusNotFound, "route not found")
		} else {
			writeError(w, http.StatusInternalServerError, "database error")
		}
		return routeScope{}, false
	}
	if rt.WallID != shared.PgUUID(wallID) {
		writeError(w, http.StatusNotFound, "route not found")
		return routeScope{}, false
	}
	wall, err := h.queries.GetWallByID(r.Context(), rt.WallID)
	if err != nil || wall.GymID != gym.ID {
		writeError(w, http.StatusNotFound, "route not found")
		return routeScope{}, false
	}
	uid := shared.PgUUID(user.GetUserID(r.Context()))
	if rt.Status == "draft" && rt.CreatedBy != uid {
		writeError(w, http.StatusNotFound, "route not found")
		return routeScope{}, false
	}
	image, err := h.queries.GetActiveWallImage(r.Context(), rt.WallID)
	legacy := errors.Is(err, pgx.ErrNoRows) || (err == nil && rt.WallImageID != image.ID)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusInternalServerError, "database error")
		return routeScope{}, false
	}
	return routeScope{route: rt, legacy: legacy, activeImage: image, activeImageFound: err == nil}, true
}

func (h *Handler) GetLogs(w http.ResponseWriter, r *http.Request) {
	scope, ok := h.scopedRoute(w, r)
	if !ok {
		return
	}
	rows, err := h.db.Query(r.Context(), `SELECT id::text, route_id::text, outcome, climbed_on::text, logged_at, notes, attempts FROM climb_logs WHERE route_id=$1 AND user_id=$2 ORDER BY climbed_on, logged_at, id`, scope.route.ID, shared.PgUUID(user.GetUserID(r.Context())))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not fetch climb history")
		return
	}
	defer rows.Close()
	logs := make([]climbLog, 0)
	for rows.Next() {
		var v climbLog
		var notes pgtype.Text
		var attempts pgtype.Int4
		if err := rows.Scan(&v.ID, &v.RouteID, &v.Outcome, &v.ClimbedOn, &v.LoggedAt, &notes, &attempts); err != nil {
			writeError(w, http.StatusInternalServerError, "database error")
			return
		}
		if notes.Valid {
			v.Notes = &notes.String
		}
		if attempts.Valid {
			v.Attempts = &attempts.Int32
		}
		logs = append(logs, v)
	}
	if err := rows.Err(); err != nil {
		writeError(w, http.StatusInternalServerError, "database error")
		return
	}
	writeJSON(w, http.StatusOK, logs)
}

func validateLogInput(in logInput) (time.Time, error) {
	if in.Outcome != "attempt" && in.Outcome != "send" && in.Outcome != "flash" {
		return time.Time{}, errors.New("outcome must be attempt, send, or flash")
	}
	date, err := time.Parse("2006-01-02", in.ClimbedOn)
	if err != nil || date.Format("2006-01-02") != in.ClimbedOn {
		return time.Time{}, errors.New("climbed_on must be a calendar date in YYYY-MM-DD format")
	}
	return date, nil
}

func (h *Handler) writeLog(w http.ResponseWriter, r *http.Request, logID string, create bool) {
	scope, ok := h.scopedRoute(w, r)
	if !ok {
		return
	}
	var in logInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	date, err := validateLogInput(in)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	uid := shared.PgUUID(user.GetUserID(r.Context()))
	if create && (scope.route.Status == "draft" || scope.legacy) {
		if scope.route.Status == "draft" {
			writeError(w, http.StatusBadRequest, "cannot log activity on a draft route")
		} else {
			writeError(w, http.StatusBadRequest, "cannot log activity on a reset route")
		}
		return
	}
	if h.txPool == nil {
		writeError(w, http.StatusInternalServerError, "transactions unavailable")
		return
	}
	tx, err := h.txPool.Begin(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "database error")
		return
	}
	defer tx.Rollback(r.Context())
	txQueries := h.queries.WithTx(tx)
	// Serialize all activity writes by this user, even across different climbs.
	if _, err := txQueries.LockUserForClimbLogs(r.Context(), uid); err != nil {
		writeError(w, http.StatusInternalServerError, "database error")
		return
	}
	id := uuid.New()
	var owned generated.GetClimbLogForUpdateRow
	if !create {
		parsed, parseErr := uuid.Parse(logID)
		if parseErr != nil {
			writeError(w, http.StatusBadRequest, "invalid log id")
			return
		}
		id = parsed
		owned, err = txQueries.GetClimbLogForUpdate(r.Context(), generated.GetClimbLogForUpdateParams{ID: shared.PgUUID(id), RouteID: scope.route.ID})
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, http.StatusNotFound, "log entry not found")
			return
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, "database error")
			return
		}
		if owned.UserID != uid {
			writeError(w, http.StatusForbidden, "you can only edit your own log entries")
			return
		}
		if in.Outcome == "flash" && owned.Attempts.Valid && owned.Attempts.Int32 > 1 {
			writeError(w, http.StatusBadRequest, "legacy entries with multiple attempts cannot be changed to Flash")
			return
		}
	}
	notes := pgtype.Text{Valid: in.Notes != nil}
	if in.Notes != nil {
		notes.String = *in.Notes
	}
	if create {
		attempts := pgtype.Int4{Valid: in.Attempts != nil}
		if in.Attempts != nil {
			attempts.Int32 = *in.Attempts
		}
		_, err = txQueries.CreateClimbLog(r.Context(), generated.CreateClimbLogParams{
			ID: shared.PgUUID(id), RouteID: scope.route.ID, UserID: uid, Outcome: in.Outcome,
			ClimbedOn: pgtype.Date{Time: date, Valid: true}, Notes: notes, Attempts: attempts,
		})
	} else {
		err = txQueries.UpdateClimbLog(r.Context(), generated.UpdateClimbLogParams{
			ID: shared.PgUUID(id), RouteID: scope.route.ID, Outcome: in.Outcome,
			ClimbedOn: pgtype.Date{Time: date, Valid: true}, Notes: notes,
		})
	}
	if err != nil {
		writeLogDBError(w, err)
		return
	}
	rows, err := txQueries.ListClimbLogsByUserRoute(r.Context(), generated.ListClimbLogsByUserRouteParams{UserID: uid, RouteID: scope.route.ID})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "database error")
		return
	}
	type historyRow struct {
		id, outcome, date string
		logged            time.Time
		attempts          pgtype.Int4
	}
	history := make([]historyRow, 0, len(rows))
	for _, row := range rows {
		history = append(history, historyRow{id: row.ID.String(), outcome: row.Outcome, date: row.ClimbedOn.Time.Format("2006-01-02"), logged: row.LoggedAt.Time, attempts: row.Attempts})
	}
	sort.Slice(history, func(i, j int) bool {
		if history[i].date != history[j].date {
			return history[i].date < history[j].date
		}
		if !history[i].logged.Equal(history[j].logged) {
			return history[i].logged.Before(history[j].logged)
		}
		return history[i].id < history[j].id
	})
	flashAt := -1
	for i, row := range history {
		if row.outcome != "flash" {
			continue
		}
		if flashAt >= 0 || (row.attempts.Valid && row.attempts.Int32 > 1) {
			writeError(w, http.StatusConflict, "history has an invalid Flash; correct or remove it first")
			return
		}
		flashAt = i
	}
	if flashAt > 0 {
		writeError(w, http.StatusConflict, "this entry would come before your Flash; correct or remove the Flash first")
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		writeLogDBError(w, err)
		return
	}
	var response climbLog
	var responseNotes pgtype.Text
	var responseAttempts pgtype.Int4
	err = h.db.QueryRow(r.Context(), `SELECT id::text,route_id::text,outcome,climbed_on::text,logged_at,notes,attempts FROM climb_logs WHERE id=$1`, shared.PgUUID(id)).Scan(&response.ID, &response.RouteID, &response.Outcome, &response.ClimbedOn, &response.LoggedAt, &responseNotes, &responseAttempts)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "database error")
		return
	}
	if responseNotes.Valid {
		response.Notes = &responseNotes.String
	}
	if responseAttempts.Valid {
		response.Attempts = &responseAttempts.Int32
	}
	status := http.StatusOK
	if create {
		status = http.StatusCreated
	}
	writeJSON(w, status, response)
}

func writeLogDBError(w http.ResponseWriter, err error) {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" {
		writeError(w, http.StatusConflict, "a Flash already exists; correct it before adding another")
		return
	}
	writeError(w, http.StatusInternalServerError, "could not save climb history")
}

func (h *Handler) CreateLog(w http.ResponseWriter, r *http.Request) { h.writeLog(w, r, "", true) }
func (h *Handler) UpdateLog(w http.ResponseWriter, r *http.Request) {
	h.writeLog(w, r, chi.URLParam(r, "logId"), false)
}

func (h *Handler) DeleteLog(w http.ResponseWriter, r *http.Request) {
	scope, ok := h.scopedRoute(w, r)
	if !ok {
		return
	}
	if h.txPool == nil {
		writeError(w, http.StatusInternalServerError, "transactions unavailable")
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "logId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid log id")
		return
	}
	uid := shared.PgUUID(user.GetUserID(r.Context()))
	tx, err := h.txPool.Begin(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "database error")
		return
	}
	defer tx.Rollback(r.Context())
	txQueries := h.queries.WithTx(tx)
	if _, err = txQueries.LockUserForClimbLogs(r.Context(), uid); err != nil {
		writeError(w, http.StatusInternalServerError, "database error")
		return
	}
	owned, err := txQueries.GetClimbLogForUpdate(r.Context(), generated.GetClimbLogForUpdateParams{ID: shared.PgUUID(id), RouteID: scope.route.ID})
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "log entry not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "database error")
		return
	}
	if owned.UserID != uid {
		writeError(w, http.StatusForbidden, "you can only delete your own log entries")
		return
	}
	if err = txQueries.DeleteClimbLog(r.Context(), shared.PgUUID(id)); err != nil {
		writeError(w, http.StatusInternalServerError, "could not delete log entry")
		return
	}
	if err = tx.Commit(r.Context()); err != nil {
		writeError(w, http.StatusInternalServerError, "could not delete log entry")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) SetRating(w http.ResponseWriter, r *http.Request) {
	scope, ok := h.scopedRoute(w, r)
	if !ok {
		return
	}
	if scope.route.Status != "published" {
		writeError(w, http.StatusBadRequest, "draft routes cannot be rated")
		return
	}
	var body struct {
		Stars int `json:"stars"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if body.Stars < 1 || body.Stars > 5 {
		writeError(w, http.StatusBadRequest, "stars must be an integer from 1 to 5")
		return
	}
	var updated time.Time
	err := h.db.QueryRow(r.Context(), `INSERT INTO route_ratings(route_id,user_id,stars) VALUES($1,$2,$3) ON CONFLICT(route_id,user_id) DO UPDATE SET stars=EXCLUDED.stars,updated_at=now() RETURNING updated_at`, scope.route.ID, shared.PgUUID(user.GetUserID(r.Context())), body.Stars).Scan(&updated)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not save rating")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"stars": body.Stars, "updated_at": updated})
}

func (h *Handler) DeleteRating(w http.ResponseWriter, r *http.Request) {
	scope, ok := h.scopedRoute(w, r)
	if !ok {
		return
	}
	if scope.route.Status != "published" {
		writeError(w, http.StatusBadRequest, "draft routes cannot be rated")
		return
	}
	if _, err := h.db.Exec(r.Context(), `DELETE FROM route_ratings WHERE route_id=$1 AND user_id=$2`, scope.route.ID, shared.PgUUID(user.GetUserID(r.Context()))); err != nil {
		writeError(w, http.StatusInternalServerError, "could not remove rating")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) LegacyLogSend(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	var body struct {
		Attempts *int32  `json:"attempts"`
		Notes    *string `json:"notes"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil && !errors.Is(err, io.EOF) {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	payload, _ := json.Marshal(logInput{Outcome: "send", ClimbedOn: time.Now().Format("2006-01-02"), Notes: body.Notes, Attempts: body.Attempts})
	r.Body = io.NopCloser(bytes.NewReader(payload))
	rec := httptest.NewRecorder()
	h.CreateLog(rec, r)
	for key, values := range rec.Header() {
		for _, value := range values {
			w.Header().Add(key, value)
		}
	}
	if rec.Code == http.StatusCreated {
		var response map[string]any
		if json.Unmarshal(rec.Body.Bytes(), &response) == nil {
			response["sent_at"] = response["logged_at"]
			response["user_id"] = user.GetUserID(r.Context()).String()
			writeJSON(w, rec.Code, response)
			return
		}
	}
	w.WriteHeader(rec.Code)
	_, _ = w.Write(rec.Body.Bytes())
}

func (h *Handler) LegacyRemoveSend(w http.ResponseWriter, r *http.Request) {
	scope, ok := h.scopedRoute(w, r)
	if !ok {
		return
	}
	var count int
	var id pgtype.Text
	err := h.db.QueryRow(r.Context(), `SELECT count(*),min(id::text) FROM climb_logs WHERE route_id=$1 AND user_id=$2 AND outcome IN ('send','flash')`, scope.route.ID, shared.PgUUID(user.GetUserID(r.Context()))).Scan(&count, &id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "database error")
		return
	}
	if count == 0 {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if count > 1 {
		writeError(w, http.StatusConflict, "multiple successful entries exist; delete a specific log entry instead")
		return
	}
	chi.RouteContext(r.Context()).URLParams.Add("logId", id.String)
	h.DeleteLog(w, r)
}

func (h *Handler) GetLegacyLogbook(w http.ResponseWriter, r *http.Request) {
	entries, err := h.queries.ListUserClimbLogs(r.Context(), shared.PgUUID(user.GetUserID(r.Context())))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not fetch logbook")
		return
	}
	out := make([]map[string]any, 0, len(entries))
	for _, entry := range entries {
		var notes, grade any
		if entry.Notes.Valid {
			notes = entry.Notes.String
		}
		if entry.RouteGrade.Valid {
			grade = entry.RouteGrade.String
		}
		loggedAt := entry.LoggedAt.Time
		out = append(out, map[string]any{
			"id": entry.ID.String(), "route_id": entry.RouteID.String(), "user_id": entry.UserID.String(),
			"logged_at": loggedAt, "sent_at": loggedAt, "climbed_on": entry.ClimbedOn.Time.Format("2006-01-02"),
			"outcome": entry.Outcome, "attempts": nullableInt(entry.Attempts), "notes": notes,
			"route_name": entry.RouteName, "route_grade": grade, "wall_id": entry.WallID.String(),
			"wall_name": entry.WallName, "gym_id": entry.GymID.String(), "gym_slug": entry.GymSlug,
		})
	}
	writeJSON(w, http.StatusOK, out)
}

func nullableInt(v pgtype.Int4) any {
	if !v.Valid {
		return nil
	}
	return v.Int32
}
