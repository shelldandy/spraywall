package route

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/bowlinedandy/spraywall/server/internal/wallaccess"
)

type wallStats struct {
	ImageID      *string         `json:"image_id"`
	Totals       statsTotals     `json:"totals"`
	Holds        []statsHold     `json:"holds"`
	Grades       []statsGrade    `json:"grades"`
	Weekly       []statsWeek     `json:"weekly"`
	MostRepeated []statsRepeated `json:"most_repeated"`
	TopRated     []statsRated    `json:"top_rated"`
	Unsent       []statsUnsent   `json:"unsent"`
	Setters      []statsSetter   `json:"setters"`
}

type statsTotals struct {
	Climbs      int `json:"climbs"`
	Ascents     int `json:"ascents"`
	Sends       int `json:"sends"`
	Flashes     int `json:"flashes"`
	Climbers    int `json:"climbers"`
	Holds       int `json:"holds"`
	UnusedHolds int `json:"unused_holds"`
}

type statsHold struct {
	HoldID  string `json:"hold_id"`
	Climbs  int    `json:"climbs"`
	Ascents int    `json:"ascents"`
	Start   int    `json:"start"`
	Finish  int    `json:"finish"`
	Foot    int    `json:"foot"`
}

type statsGrade struct {
	Grade   *string `json:"grade"`
	Climbs  int     `json:"climbs"`
	Sends   int     `json:"sends"`
	Flashes int     `json:"flashes"`
}

type statsWeek struct {
	WeekStart string `json:"week_start"`
	Ascents   int    `json:"ascents"`
	Climbers  int    `json:"climbers"`
}

type statsRepeated struct {
	RouteID string  `json:"route_id"`
	Name    string  `json:"name"`
	Grade   *string `json:"grade"`
	Sends   int     `json:"sends"`
}

type statsRated struct {
	RouteID       string  `json:"route_id"`
	Name          string  `json:"name"`
	Grade         *string `json:"grade"`
	RatingAverage float64 `json:"rating_average"`
	RatingCount   int     `json:"rating_count"`
}

type statsUnsent struct {
	RouteID   string    `json:"route_id"`
	Name      string    `json:"name"`
	Grade     *string   `json:"grade"`
	CreatedAt time.Time `json:"created_at"`
}

type statsSetter struct {
	UserID      string `json:"user_id"`
	DisplayName string `json:"display_name"`
	Climbs      int    `json:"climbs"`
}

// WallStats handles GET /walls/{wallId}/stats.
func (h *Handler) WallStats(w http.ResponseWriter, r *http.Request) {
	wall, _, err := wallaccess.RequireWall(w, r, h.queries)
	if err != nil {
		return
	}
	ctx := r.Context()
	stats := wallStats{
		Holds: []statsHold{}, Grades: []statsGrade{}, Weekly: []statsWeek{},
		MostRepeated: []statsRepeated{}, TopRated: []statsRated{}, Unsent: []statsUnsent{}, Setters: []statsSetter{},
	}
	var imageID pgtype.UUID
	if err := h.db.QueryRow(ctx, `SELECT id FROM wall_images WHERE wall_id=$1 AND is_active ORDER BY created_at DESC LIMIT 1`, wall.ID).Scan(&imageID); err != nil && !errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusInternalServerError, "could not fetch wall stats")
		return
	}
	var image any
	if imageID.Valid {
		id := imageID.String()
		stats.ImageID = &id
		image = imageID
	}
	activeRoutes := `SELECT r.* FROM routes r WHERE r.wall_id=$1 AND r.wall_image_id=$2 AND r.status='published'`
	if err := h.db.QueryRow(ctx, `WITH routes AS (`+activeRoutes+`), logs AS (SELECT l.* FROM climb_logs l JOIN routes r ON r.id=l.route_id)
SELECT (SELECT count(*) FROM routes), (SELECT count(*) FROM logs),
       (SELECT count(*) FROM logs WHERE outcome='send'), (SELECT count(*) FROM logs WHERE outcome='flash'),
       (SELECT count(DISTINCT user_id) FROM logs),
       (SELECT count(*) FROM holds WHERE wall_image_id=$2),
       (SELECT count(*) FROM holds h WHERE h.wall_image_id=$2 AND NOT EXISTS (SELECT 1 FROM routes r WHERE h.id=ANY(r.hold_ids)))`, wall.ID, image).Scan(
		&stats.Totals.Climbs, &stats.Totals.Ascents, &stats.Totals.Sends, &stats.Totals.Flashes,
		&stats.Totals.Climbers, &stats.Totals.Holds, &stats.Totals.UnusedHolds,
	); err != nil {
		writeError(w, http.StatusInternalServerError, "could not fetch wall stats")
		return
	}
	rows, err := h.db.Query(ctx, `WITH routes AS (`+activeRoutes+`), route_logs AS (
 SELECT l.route_id, count(*) AS ascents FROM climb_logs l JOIN routes r ON r.id=l.route_id GROUP BY l.route_id
), hold_routes AS (
 SELECT DISTINCT h.id AS hold_id, r.id AS route_id,
        count(*) FILTER (WHERE roles.role='start') AS start,
        count(*) FILTER (WHERE roles.role='finish') AS finish,
        count(*) FILTER (WHERE roles.role='foot') AS foot
 FROM holds h LEFT JOIN routes r ON h.id=ANY(r.hold_ids)
 LEFT JOIN LATERAL (SELECT key AS role FROM jsonb_each(COALESCE(r.hold_roles,'{}'::jsonb)) e CROSS JOIN LATERAL jsonb_array_elements_text(e.value) v(value) WHERE v.value=h.id::text) roles ON true
 WHERE h.wall_image_id=$2 GROUP BY h.id,r.id
)
SELECT h.id::text, count(hr.route_id)::int, COALESCE(sum(rl.ascents),0)::int,
       COALESCE(sum(hr.start),0)::int, COALESCE(sum(hr.finish),0)::int, COALESCE(sum(hr.foot),0)::int
FROM holds h LEFT JOIN hold_routes hr ON hr.hold_id=h.id LEFT JOIN route_logs rl ON rl.route_id=hr.route_id
WHERE h.wall_image_id=$2 GROUP BY h.id ORDER BY h.id`, wall.ID, image)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not fetch wall stats")
		return
	}
	for rows.Next() {
		var v statsHold
		if err := rows.Scan(&v.HoldID, &v.Climbs, &v.Ascents, &v.Start, &v.Finish, &v.Foot); err != nil {
			rows.Close()
			writeError(w, http.StatusInternalServerError, "could not fetch wall stats")
			return
		}
		stats.Holds = append(stats.Holds, v)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		writeError(w, http.StatusInternalServerError, "could not fetch wall stats")
		return
	}
	rows.Close()

	gradeRows, err := h.db.Query(ctx, `WITH routes AS (`+activeRoutes+`), log_counts AS (
 SELECT route_id, count(*) FILTER (WHERE outcome='send') AS sends, count(*) FILTER (WHERE outcome='flash') AS flashes
 FROM climb_logs GROUP BY route_id
)
SELECT r.grade, count(*)::int, COALESCE(sum(l.sends),0)::int, COALESCE(sum(l.flashes),0)::int
FROM routes r LEFT JOIN log_counts l ON l.route_id=r.id GROUP BY r.grade ORDER BY r.grade NULLS LAST`, wall.ID, image)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not fetch wall stats")
		return
	}
	for gradeRows.Next() {
		var v statsGrade
		var grade pgtype.Text
		if err := gradeRows.Scan(&grade, &v.Climbs, &v.Sends, &v.Flashes); err != nil {
			gradeRows.Close()
			writeError(w, http.StatusInternalServerError, "could not fetch wall stats")
			return
		}
		if grade.Valid {
			v.Grade = &grade.String
		}
		stats.Grades = append(stats.Grades, v)
	}
	if err := gradeRows.Err(); err != nil {
		gradeRows.Close()
		writeError(w, http.StatusInternalServerError, "could not fetch wall stats")
		return
	}
	gradeRows.Close()

	weekRows, err := h.db.Query(ctx, `WITH routes AS (`+activeRoutes+`), weeks AS (
 SELECT d::date AS week_start FROM generate_series(date_trunc('week', CURRENT_DATE)::date - interval '11 weeks', date_trunc('week', CURRENT_DATE)::date, interval '1 week') d
), logs AS (SELECT l.* FROM climb_logs l JOIN routes r ON r.id=l.route_id)
SELECT w.week_start::text, count(l.*)::int, count(DISTINCT l.user_id)::int FROM weeks w LEFT JOIN logs l ON date_trunc('week',l.climbed_on)::date=w.week_start GROUP BY w.week_start ORDER BY w.week_start`, wall.ID, image)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not fetch wall stats")
		return
	}
	for weekRows.Next() {
		var v statsWeek
		if err := weekRows.Scan(&v.WeekStart, &v.Ascents, &v.Climbers); err != nil {
			weekRows.Close()
			writeError(w, http.StatusInternalServerError, "could not fetch wall stats")
			return
		}
		stats.Weekly = append(stats.Weekly, v)
	}
	if err := weekRows.Err(); err != nil {
		weekRows.Close()
		writeError(w, http.StatusInternalServerError, "could not fetch wall stats")
		return
	}
	weekRows.Close()

	if err := h.queryStatsRows(ctx, &stats, wall.ID, image, activeRoutes); err != nil {
		writeError(w, http.StatusInternalServerError, "could not fetch wall stats")
		return
	}
	writeJSON(w, http.StatusOK, stats)
}

func (h *Handler) queryStatsRows(ctx context.Context, stats *wallStats, wallID pgtype.UUID, image any, activeRoutes string) error {
	queries := []struct {
		dest any
		sql  string
	}{
		{&stats.MostRepeated, `WITH routes AS (` + activeRoutes + `)
SELECT r.id::text,r.name,r.grade,count(l.*)::int FROM routes r JOIN climb_logs l ON l.route_id=r.id AND l.outcome IN ('send','flash')
GROUP BY r.id,r.name,r.grade ORDER BY count(l.*) DESC,r.name,r.id LIMIT 5`},
		{&stats.TopRated, `WITH routes AS (` + activeRoutes + `)
SELECT r.id::text,r.name,r.grade,avg(rr.stars)::float8,count(rr.*)::int FROM routes r JOIN route_ratings rr ON rr.route_id=r.id
GROUP BY r.id,r.name,r.grade HAVING count(rr.*)>=2 ORDER BY avg(rr.stars) DESC,count(rr.*) DESC,r.name,r.id LIMIT 5`},
		{&stats.Unsent, `WITH routes AS (` + activeRoutes + `)
SELECT r.id::text,r.name,r.grade,r.created_at FROM routes r WHERE NOT EXISTS (
 SELECT 1 FROM climb_logs l WHERE l.route_id=r.id AND l.outcome IN ('send','flash')) ORDER BY r.created_at DESC,r.id LIMIT 10`},
		{&stats.Setters, `WITH routes AS (` + activeRoutes + `)
SELECT u.id::text,u.display_name,count(*)::int FROM routes r JOIN users u ON u.id=r.created_by GROUP BY u.id,u.display_name ORDER BY count(*) DESC,u.display_name,u.id`},
	}
	for _, q := range queries {
		rows, err := h.db.Query(ctx, q.sql, wallID, image)
		if err != nil {
			return err
		}
		switch dest := q.dest.(type) {
		case *[]statsRepeated:
			for rows.Next() {
				var v statsRepeated
				var grade pgtype.Text
				if err := rows.Scan(&v.RouteID, &v.Name, &grade, &v.Sends); err != nil {
					rows.Close()
					return err
				}
				if grade.Valid {
					v.Grade = &grade.String
				}
				*dest = append(*dest, v)
			}
		case *[]statsRated:
			for rows.Next() {
				var v statsRated
				var grade pgtype.Text
				if err := rows.Scan(&v.RouteID, &v.Name, &grade, &v.RatingAverage, &v.RatingCount); err != nil {
					rows.Close()
					return err
				}
				if grade.Valid {
					v.Grade = &grade.String
				}
				*dest = append(*dest, v)
			}
		case *[]statsUnsent:
			for rows.Next() {
				var v statsUnsent
				var grade pgtype.Text
				if err := rows.Scan(&v.RouteID, &v.Name, &grade, &v.CreatedAt); err != nil {
					rows.Close()
					return err
				}
				if grade.Valid {
					v.Grade = &grade.String
				}
				*dest = append(*dest, v)
			}
		case *[]statsSetter:
			for rows.Next() {
				var v statsSetter
				if err := rows.Scan(&v.UserID, &v.DisplayName, &v.Climbs); err != nil {
					rows.Close()
					return err
				}
				*dest = append(*dest, v)
			}
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return err
		}
		rows.Close()
	}
	return nil
}
