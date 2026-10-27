package route

import (
	"encoding/base64"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/bowlinedandy/spraywall/server/db/generated"
	"github.com/bowlinedandy/spraywall/server/internal/shared"
	"github.com/bowlinedandy/spraywall/server/internal/user"
)

const (
	defaultActivityLimit = 20
	maxActivityLimit     = 50
)

type activityUser struct {
	ID          string  `json:"id"`
	DisplayName string  `json:"display_name"`
	AvatarURL   *string `json:"avatar_url"`
}

type activityItem struct {
	ID          string       `json:"id"`
	RouteID     string       `json:"route_id"`
	RouteName   string       `json:"route_name"`
	RouteGrade  *string      `json:"route_grade"`
	RouteLegacy bool         `json:"route_is_legacy"`
	Outcome     string       `json:"outcome"`
	ClimbedOn   string       `json:"climbed_on"`
	LoggedAt    time.Time    `json:"logged_at"`
	Notes       *string      `json:"notes"`
	Attempts    *int32       `json:"attempts"`
	User        activityUser `json:"user"`
}

type activityPage struct {
	Items      []activityItem `json:"items"`
	NextCursor *string        `json:"next_cursor"`
}

type activityCursor struct {
	climbedOn string
	loggedAt  time.Time
	id        uuid.UUID
}

// WallActivity handles GET /gyms/{gymSlug}/walls/{wallId}/activity.
func (h *Handler) WallActivity(w http.ResponseWriter, r *http.Request) {
	gym, _, err := h.requireGymMember(w, r)
	if err != nil {
		return
	}
	wallID, err := parseWallID(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid wall id")
		return
	}
	wall, err := h.queries.GetWallByID(r.Context(), shared.PgUUID(wallID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, http.StatusNotFound, "wall not found")
		} else {
			writeError(w, http.StatusInternalServerError, "database error")
		}
		return
	}
	if wall.GymID != gym.ID {
		writeError(w, http.StatusNotFound, "wall not found")
		return
	}

	limit, cursor, ok := parseActivityPage(w, r)
	if !ok {
		return
	}
	page, err := h.queryActivity(r, wall.ID, nil, limit, cursor)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not fetch activity")
		return
	}
	writeJSON(w, http.StatusOK, page)
}

// RouteActivity handles GET /gyms/{gymSlug}/walls/{wallId}/routes/{routeId}/activity.
func (h *Handler) RouteActivity(w http.ResponseWriter, r *http.Request) {
	scope, ok := h.scopedRoute(w, r)
	if !ok {
		return
	}
	limit, cursor, ok := parseActivityPage(w, r)
	if !ok {
		return
	}
	page, err := h.queryActivity(r, scope.route.WallID, &scope.route.ID, limit, cursor)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not fetch activity")
		return
	}
	writeJSON(w, http.StatusOK, page)
}

func parseActivityPage(w http.ResponseWriter, r *http.Request) (int, *activityCursor, bool) {
	limit := defaultActivityLimit
	if raw := r.URL.Query().Get("limit"); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 1 {
			writeError(w, http.StatusBadRequest, "limit must be a positive integer")
			return 0, nil, false
		}
		limit = parsed
		if limit > maxActivityLimit {
			limit = maxActivityLimit
		}
	}
	cursorValue := r.URL.Query().Get("cursor")
	if cursorValue == "" {
		return limit, nil, true
	}
	cursor, err := decodeActivityCursor(cursorValue)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid activity cursor")
		return 0, nil, false
	}
	return limit, &cursor, true
}

func decodeActivityCursor(value string) (activityCursor, error) {
	var cursor activityCursor
	decoded, err := base64.RawURLEncoding.DecodeString(value)
	if err != nil {
		// Accept padded URL-safe and standard base64 encodings as well.
		decoded, err = base64.URLEncoding.DecodeString(value)
	}
	if err != nil {
		decoded, err = base64.StdEncoding.DecodeString(value)
	}
	if err != nil {
		return cursor, err
	}
	parts := strings.Split(string(decoded), "|")
	if len(parts) != 3 {
		return cursor, fmt.Errorf("cursor must contain date, timestamp, and id")
	}
	if _, err := time.Parse("2006-01-02", parts[0]); err != nil {
		return cursor, err
	}
	cursor.loggedAt, err = time.Parse(time.RFC3339Nano, parts[1])
	if err != nil {
		return cursor, err
	}
	cursor.id, err = uuid.Parse(parts[2])
	if err != nil {
		return cursor, err
	}
	cursor.climbedOn = parts[0]
	return cursor, nil
}

func encodeActivityCursor(item activityItem) string {
	value := strings.Join([]string{
		item.ClimbedOn,
		item.LoggedAt.UTC().Format(time.RFC3339Nano),
		item.ID,
	}, "|")
	return base64.RawURLEncoding.EncodeToString([]byte(value))
}

func (h *Handler) queryActivity(r *http.Request, wallID pgtype.UUID, routeID *pgtype.UUID, limit int, cursor *activityCursor) (activityPage, error) {
	var routeFilter any
	if routeID != nil {
		routeFilter = *routeID
	}
	var cursorDate, cursorTime, cursorID any
	if cursor != nil {
		cursorDate = cursor.climbedOn
		cursorTime = cursor.loggedAt
		cursorID = shared.PgUUID(cursor.id)
	}
	rows, err := h.db.Query(r.Context(), `
SELECT l.id::text, l.route_id::text, r.name, r.grade,
       (r.wall_image_id IS DISTINCT FROM (
           SELECT wi.id FROM wall_images wi WHERE wi.wall_id = r.wall_id AND wi.is_active
       )) AS is_legacy,
       l.outcome, l.climbed_on::text, l.logged_at, l.notes, l.attempts,
       u.id::text, u.display_name, u.avatar_key
FROM climb_logs l
JOIN routes r ON r.id = l.route_id
JOIN users u ON u.id = l.user_id
WHERE r.wall_id = $1
  AND ($2::uuid IS NULL OR l.route_id = $2)
  AND (r.status = 'published' OR r.created_by = $3)
  AND ($4::date IS NULL OR (l.climbed_on, l.logged_at, l.id) < ($4::date, $5::timestamptz, $6::uuid))
ORDER BY l.climbed_on DESC, l.logged_at DESC, l.id DESC
LIMIT $7`, wallID, routeFilter, shared.PgUUID(user.GetUserID(r.Context())), cursorDate, cursorTime, cursorID, limit+1)
	if err != nil {
		return activityPage{}, err
	}
	defer rows.Close()

	items := make([]activityItem, 0, limit+1)
	for rows.Next() {
		var item activityItem
		var grade, notes, avatarKey pgtype.Text
		var attempts pgtype.Int4
		if err := rows.Scan(
			&item.ID, &item.RouteID, &item.RouteName, &grade, &item.RouteLegacy,
			&item.Outcome, &item.ClimbedOn, &item.LoggedAt, &notes, &attempts,
			&item.User.ID, &item.User.DisplayName, &avatarKey,
		); err != nil {
			return activityPage{}, err
		}
		if grade.Valid {
			item.RouteGrade = &grade.String
		}
		if notes.Valid {
			item.Notes = &notes.String
		}
		if attempts.Valid {
			item.Attempts = &attempts.Int32
		}
		item.User.AvatarURL = user.AvatarURL(generated.User{AvatarKey: avatarKey})
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return activityPage{}, err
	}

	page := activityPage{Items: items}
	if len(items) > limit {
		page.Items = items[:limit]
		page.NextCursor = stringPointer(encodeActivityCursor(page.Items[len(page.Items)-1]))
	}
	return page, nil
}

func stringPointer(value string) *string { return &value }
