package wall

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/bowlinedandy/spraywall/server/internal/shared"
)

type resetAlignment struct {
	Homography [][]float64 `json:"homography"`
	Inliers    int         `json:"inliers"`
	OK         bool        `json:"ok"`
}

type resetHold struct {
	ID               uuid.UUID       `json:"id"`
	BBox             json.RawMessage `json:"bbox"`
	Polygon          json.RawMessage `json:"polygon"`
	Confidence       float32         `json:"confidence"`
	MatchedOldHoldID *uuid.UUID      `json:"matched_old_hold_id"`
}

type removedResetHold struct {
	OldHoldID  uuid.UUID       `json:"old_hold_id"`
	BBox       json.RawMessage `json:"bbox"`
	Polygon    json.RawMessage `json:"polygon"`
	Confidence float32         `json:"confidence"`
}

func (h *Handler) resetAccess(w http.ResponseWriter, r *http.Request) (uuid.UUID, uuid.UUID, bool) {
	if h.pool == nil {
		writeError(w, http.StatusInternalServerError, "database unavailable")
		return uuid.Nil, uuid.Nil, false
	}
	gym, member, err := h.requireGymMember(w, r)
	if err != nil {
		return uuid.Nil, uuid.Nil, false
	}
	if member.Role != "admin" && member.Role != "setter" {
		writeError(w, http.StatusForbidden, "only setters or admins can manage resets")
		return uuid.Nil, uuid.Nil, false
	}
	wallID, err := uuid.Parse(chi.URLParam(r, "wallId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid wall id")
		return uuid.Nil, uuid.Nil, false
	}
	wall, err := h.queries.GetWallByID(r.Context(), shared.PgUUID(wallID))
	if err != nil || wall.GymID != gym.ID {
		writeError(w, http.StatusNotFound, "wall not found")
		return uuid.Nil, uuid.Nil, false
	}
	imageID, err := uuid.Parse(chi.URLParam(r, "imageId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid image id")
		return uuid.Nil, uuid.Nil, false
	}
	return wallID, imageID, true
}

func resetAlignmentFor(ctx context.Context, pool *pgxpool.Pool, imageID uuid.UUID) (resetAlignment, error) {
	var raw []byte
	err := pool.QueryRow(ctx, `SELECT alignment FROM wall_images WHERE id=$1`, imageID).Scan(&raw)
	if err != nil {
		return resetAlignment{}, err
	}
	var alignment resetAlignment
	if err := json.Unmarshal(raw, &alignment); err != nil {
		return resetAlignment{}, err
	}
	return alignment, nil
}

func projectPoint(x, y float64, h [][]float64) (float64, float64, bool) {
	if len(h) != 3 || len(h[0]) != 3 || len(h[1]) != 3 || len(h[2]) != 3 {
		return 0, 0, false
	}
	denom := h[2][0]*x + h[2][1]*y + h[2][2]
	if math.Abs(denom) < 1e-12 {
		return 0, 0, false
	}
	return (h[0][0]*x + h[0][1]*y + h[0][2]) / denom, (h[1][0]*x + h[1][1]*y + h[1][2]) / denom, true
}

func inverseHomography(matrix [][]float64) ([][]float64, bool) {
	if len(matrix) != 3 || len(matrix[0]) != 3 || len(matrix[1]) != 3 || len(matrix[2]) != 3 {
		return nil, false
	}
	a, b, c := matrix[0][0], matrix[0][1], matrix[0][2]
	d, e, f := matrix[1][0], matrix[1][1], matrix[1][2]
	g, h, i := matrix[2][0], matrix[2][1], matrix[2][2]
	det := a*(e*i-f*h) - b*(d*i-f*g) + c*(d*h-e*g)
	if math.Abs(det) < 1e-12 {
		return nil, false
	}
	return [][]float64{{(e*i - f*h) / det, (c*h - b*i) / det, (b*f - c*e) / det}, {(f*g - d*i) / det, (a*i - c*g) / det, (c*d - a*f) / det}, {(d*h - e*g) / det, (b*g - a*h) / det, (a*e - b*d) / det}}, true
}

func projectBBox(raw json.RawMessage, matrix [][]float64) (json.RawMessage, bool) {
	var box struct {
		X float64 `json:"x"`
		Y float64 `json:"y"`
		W float64 `json:"w"`
		H float64 `json:"h"`
	}
	if json.Unmarshal(raw, &box) != nil {
		return nil, false
	}
	points := [][2]float64{{box.X, box.Y}, {box.X + box.W, box.Y}, {box.X, box.Y + box.H}, {box.X + box.W, box.Y + box.H}}
	minX, minY, maxX, maxY := math.Inf(1), math.Inf(1), math.Inf(-1), math.Inf(-1)
	for _, p := range points {
		x, y, ok := projectPoint(p[0], p[1], matrix)
		if !ok {
			return nil, false
		}
		minX = math.Min(minX, x)
		minY = math.Min(minY, y)
		maxX = math.Max(maxX, x)
		maxY = math.Max(maxY, y)
	}
	out, _ := json.Marshal(map[string]float64{"x": minX, "y": minY, "w": maxX - minX, "h": maxY - minY})
	return out, true
}

func projectPolygon(raw json.RawMessage, matrix [][]float64) json.RawMessage {
	if len(raw) == 0 || string(raw) == "null" {
		return raw
	}
	var points [][]float64
	if json.Unmarshal(raw, &points) != nil {
		return raw
	}
	for i, p := range points {
		if len(p) < 2 {
			return raw
		}
		x, y, ok := projectPoint(p[0], p[1], matrix)
		if !ok {
			return raw
		}
		points[i][0], points[i][1] = x, y
	}
	b, _ := json.Marshal(points)
	return b
}

func (h *Handler) GetReset(w http.ResponseWriter, r *http.Request) {
	wallID, imageID, ok := h.resetAccess(w, r)
	if !ok {
		return
	}
	var parent pgtype.UUID
	var reviewStatus *string
	var alignmentRaw []byte
	err := h.pool.QueryRow(r.Context(), `SELECT parent_image_id,review_status,alignment FROM wall_images WHERE id=$1 AND wall_id=$2 AND reset_kind='partial'`, shared.PgUUID(imageID), shared.PgUUID(wallID)).Scan(&parent, &reviewStatus, &alignmentRaw)
	if err != nil || !parent.Valid || reviewStatus == nil || *reviewStatus != "pending" {
		writeError(w, http.StatusNotFound, "pending reset not found")
		return
	}
	var a resetAlignment
	_ = json.Unmarshal(alignmentRaw, &a)
	inverse, hasInverse := inverseHomography(a.Homography)
	matches := map[uuid.UUID]uuid.UUID{}
	rows, err := h.pool.Query(r.Context(), `SELECT old_hold_id,new_hold_id FROM hold_matches WHERE wall_image_id=$1`, shared.PgUUID(imageID))
	if err != nil {
		writeError(w, 500, "could not load matches")
		return
	}
	for rows.Next() {
		var oldID, newID uuid.UUID
		if rows.Scan(&oldID, &newID) == nil {
			matches[oldID] = newID
		}
	}
	rows.Close()
	newRows, err := h.pool.Query(r.Context(), `SELECT id,bbox,polygon,confidence FROM holds WHERE wall_image_id=$1 ORDER BY confidence DESC`, shared.PgUUID(imageID))
	if err != nil {
		writeError(w, 500, "could not load holds")
		return
	}
	newHolds := []resetHold{}
	for newRows.Next() {
		var item resetHold
		if err := newRows.Scan(&item.ID, &item.BBox, &item.Polygon, &item.Confidence); err != nil {
			newRows.Close()
			writeError(w, 500, "could not load holds")
			return
		}
		for old, id := range matches {
			if id == item.ID {
				v := old
				item.MatchedOldHoldID = &v
				break
			}
		}
		newHolds = append(newHolds, item)
	}
	newRows.Close()
	oldRows, err := h.pool.Query(r.Context(), `SELECT id,bbox,polygon,confidence FROM holds WHERE wall_image_id=$1 ORDER BY confidence DESC`, parent)
	if err != nil {
		writeError(w, 500, "could not load old holds")
		return
	}
	removed := []removedResetHold{}
	for oldRows.Next() {
		var id uuid.UUID
		var bbox, polygon json.RawMessage
		var confidence float32
		if oldRows.Scan(&id, &bbox, &polygon, &confidence) != nil {
			continue
		}
		if _, matched := matches[id]; matched {
			continue
		}
		if hasInverse {
			if p, good := projectBBox(bbox, inverse); good {
				bbox = p
			}
			polygon = projectPolygon(polygon, inverse)
		}
		removed = append(removed, removedResetHold{id, bbox, polygon, confidence})
	}
	oldRows.Close()
	type affected struct {
		ID      uuid.UUID   `json:"id"`
		Name    string      `json:"name"`
		Grade   *string     `json:"grade"`
		Status  string      `json:"status"`
		Missing []uuid.UUID `json:"missing_hold_ids"`
	}
	routes, err := h.pool.Query(r.Context(), `SELECT id,name,grade,status,hold_ids FROM routes WHERE wall_image_id=$1 ORDER BY id`, parent)
	if err != nil {
		writeError(w, 500, "could not load routes")
		return
	}
	affectedRoutes := []affected{}
	kept := 0
	for routes.Next() {
		var item affected
		var ids []uuid.UUID
		if routes.Scan(&item.ID, &item.Name, &item.Grade, &item.Status, &ids) != nil {
			continue
		}
		for _, id := range ids {
			if _, yes := matches[id]; !yes {
				item.Missing = append(item.Missing, id)
			}
		}
		if len(item.Missing) == 0 {
			kept++
		} else {
			affectedRoutes = append(affectedRoutes, item)
		}
	}
	routes.Close()
	var detectionStatus string
	_ = h.pool.QueryRow(r.Context(), `SELECT COALESCE((SELECT status FROM detection_jobs WHERE wall_image_id=$1 ORDER BY created_at DESC LIMIT 1), 'pending')`, shared.PgUUID(imageID)).Scan(&detectionStatus)
	writeJSON(w, 200, map[string]any{"new_holds": newHolds, "removed_holds": removed, "alignment": map[string]any{"ok": a.OK, "inliers": a.Inliers}, "affected_routes": affectedRoutes, "kept_route_count": kept, "detection_status": detectionStatus})
}

func (h *Handler) UpdateResetMatch(w http.ResponseWriter, r *http.Request) {
	wallID, imageID, ok := h.resetAccess(w, r)
	if !ok {
		return
	}
	var body struct {
		Old uuid.UUID  `json:"old_hold_id"`
		New *uuid.UUID `json:"new_hold_id"`
	}
	if json.NewDecoder(r.Body).Decode(&body) != nil || body.Old == uuid.Nil {
		writeError(w, 400, "invalid match")
		return
	}
	tx, err := h.pool.Begin(r.Context())
	if err != nil {
		writeError(w, 500, "database error")
		return
	}
	defer tx.Rollback(context.Background())
	var parent pgtype.UUID
	var reviewStatus *string
	var active bool
	err = tx.QueryRow(r.Context(), `SELECT wi.parent_image_id,wi.review_status,wi.is_active FROM wall_images wi WHERE wi.id=$1 AND wi.wall_id=$2 AND wi.reset_kind='partial' FOR UPDATE`, shared.PgUUID(imageID), shared.PgUUID(wallID)).Scan(&parent, &reviewStatus, &active)
	if err != nil || !parent.Valid || reviewStatus == nil || *reviewStatus != "pending" || active {
		writeError(w, 404, "pending reset not found")
		return
	}
	var exists bool
	err = tx.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM holds WHERE id=$1 AND wall_image_id=$2)`, body.Old, parent).Scan(&exists)
	if err != nil || !exists {
		writeError(w, 400, "old hold does not belong to parent image")
		return
	}
	if body.New == nil {
		_, err = tx.Exec(r.Context(), `DELETE FROM hold_matches WHERE wall_image_id=$1 AND old_hold_id=$2`, shared.PgUUID(imageID), body.Old)
	} else {
		err = upsertMatch(r.Context(), tx, imageID, body.Old, *body.New)
	}
	if err != nil {
		writeError(w, 400, "invalid hold match")
		return
	}
	if tx.Commit(r.Context()) != nil {
		writeError(w, 500, "database error")
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true})
}

func upsertMatch(ctx context.Context, tx pgx.Tx, imageID, oldID, newID uuid.UUID) error {
	var parent pgtype.UUID
	var wallID uuid.UUID
	if err := tx.QueryRow(ctx, `SELECT parent_image_id,wall_id FROM wall_images WHERE id=$1`, imageID).Scan(&parent, &wallID); err != nil {
		return err
	}
	var valid bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM holds WHERE id=$1 AND wall_image_id=$2)`, newID, imageID).Scan(&valid); err != nil || !valid {
		return errors.New("new hold does not belong to pending image")
	}
	if _, err := tx.Exec(ctx, `DELETE FROM hold_matches WHERE wall_image_id=$1 AND (old_hold_id=$2 OR new_hold_id=$3)`, imageID, oldID, newID); err != nil {
		return err
	}
	_, err := tx.Exec(ctx, `INSERT INTO hold_matches(wall_image_id,old_hold_id,new_hold_id,source,iou) VALUES($1,$2,$3,'manual',NULL)`, imageID, oldID, newID)
	return err
}

func (h *Handler) RestoreResetHold(w http.ResponseWriter, r *http.Request) {
	wallID, imageID, ok := h.resetAccess(w, r)
	if !ok {
		return
	}
	var body struct {
		Old uuid.UUID `json:"old_hold_id"`
	}
	if json.NewDecoder(r.Body).Decode(&body) != nil || body.Old == uuid.Nil {
		writeError(w, 400, "invalid old_hold_id")
		return
	}
	tx, err := h.pool.Begin(r.Context())
	if err != nil {
		writeError(w, 500, "database error")
		return
	}
	defer tx.Rollback(context.Background())
	var parent pgtype.UUID
	var reviewStatus *string
	var active bool
	err = tx.QueryRow(r.Context(), `SELECT parent_image_id,review_status,is_active FROM wall_images WHERE id=$1 AND wall_id=$2 AND reset_kind='partial' FOR UPDATE`, shared.PgUUID(imageID), shared.PgUUID(wallID)).Scan(&parent, &reviewStatus, &active)
	if err != nil || !parent.Valid || reviewStatus == nil || *reviewStatus != "pending" || active {
		writeError(w, 404, "pending reset not found")
		return
	}
	var bbox, polygon []byte
	err = tx.QueryRow(r.Context(), `SELECT bbox,polygon FROM holds WHERE id=$1 AND wall_image_id=$2`, body.Old, parent).Scan(&bbox, &polygon)
	if err != nil {
		writeError(w, 404, "old hold not found")
		return
	}
	alignment, err := resetAlignmentFor(r.Context(), h.pool, imageID)
	if err != nil {
		writeError(w, 409, "alignment unavailable")
		return
	}
	inverse, valid := inverseHomography(alignment.Homography)
	if !valid {
		writeError(w, 409, "alignment unavailable")
		return
	}
	projected, valid := projectBBox(bbox, inverse)
	if !valid {
		writeError(w, 409, "could not project old hold")
		return
	}
	projectedPolygon := projectPolygon(polygon, inverse)
	var newID uuid.UUID
	err = tx.QueryRow(r.Context(), `INSERT INTO holds(wall_image_id,bbox,polygon,confidence) VALUES($1,$2,$3,1.0) RETURNING id`, shared.PgUUID(imageID), projected, projectedPolygon).Scan(&newID)
	if err == nil {
		_, err = tx.Exec(r.Context(), `DELETE FROM hold_matches WHERE wall_image_id=$1 AND (old_hold_id=$2 OR new_hold_id=$3)`, shared.PgUUID(imageID), body.Old, newID)
	}
	if err == nil {
		_, err = tx.Exec(r.Context(), `INSERT INTO hold_matches(wall_image_id,old_hold_id,new_hold_id,source,iou) VALUES($1,$2,$3,'manual',NULL)`, shared.PgUUID(imageID), body.Old, newID)
	}
	if err != nil {
		writeError(w, 500, "could not restore hold")
		return
	}
	if tx.Commit(r.Context()) != nil {
		writeError(w, 500, "database error")
		return
	}
	writeJSON(w, 201, map[string]any{"id": newID, "wall_image_id": imageID, "bbox": json.RawMessage(projected), "polygon": json.RawMessage(projectedPolygon), "confidence": 1.0})
}

func (h *Handler) ApplyReset(w http.ResponseWriter, r *http.Request) {
	wallID, imageID, ok := h.resetAccess(w, r)
	if !ok {
		return
	}
	tx, err := h.pool.Begin(r.Context())
	if err != nil {
		writeError(w, 500, "database error")
		return
	}
	defer tx.Rollback(context.Background())
	lockedImages, lockErr := tx.Query(r.Context(), `SELECT id FROM wall_images WHERE wall_id=$1 ORDER BY id FOR UPDATE`, shared.PgUUID(wallID))
	if lockErr != nil {
		writeError(w, 500, "could not lock wall images")
		return
	}
	for lockedImages.Next() {
		var ignored uuid.UUID
		if err := lockedImages.Scan(&ignored); err != nil {
			lockedImages.Close()
			writeError(w, 500, "could not lock wall images")
			return
		}
	}
	lockedImages.Close()
	var parent pgtype.UUID
	var reviewStatus *string
	var active bool
	err = tx.QueryRow(r.Context(), `SELECT parent_image_id,review_status,is_active FROM wall_images WHERE id=$1 AND wall_id=$2 AND reset_kind='partial' FOR UPDATE`, shared.PgUUID(imageID), shared.PgUUID(wallID)).Scan(&parent, &reviewStatus, &active)
	if err != nil || !parent.Valid || reviewStatus == nil || *reviewStatus != "pending" || active {
		writeError(w, 409, "pending reset is stale")
		return
	}
	var parentActive bool
	err = tx.QueryRow(r.Context(), `SELECT is_active FROM wall_images WHERE id=$1 AND wall_id=$2 FOR UPDATE`, parent, shared.PgUUID(wallID)).Scan(&parentActive)
	if err != nil || !parentActive {
		writeError(w, 409, "pending reset parent is no longer active")
		return
	}
	var status string
	err = tx.QueryRow(r.Context(), `SELECT status FROM detection_jobs WHERE wall_image_id=$1 ORDER BY created_at DESC LIMIT 1`, shared.PgUUID(imageID)).Scan(&status)
	if err != nil || status != "done" {
		writeError(w, 409, "pending reset detection is not complete")
		return
	}
	rows, err := tx.Query(r.Context(), `SELECT id,hold_ids,hold_roles FROM routes WHERE wall_image_id=$1 FOR UPDATE`, parent)
	if err != nil {
		writeError(w, 500, "could not lock routes")
		return
	}
	type routeData struct {
		id    uuid.UUID
		ids   []uuid.UUID
		roles []byte
	}
	all := []routeData{}
	for rows.Next() {
		var x routeData
		if rows.Scan(&x.id, &x.ids, &x.roles) == nil {
			all = append(all, x)
		}
	}
	rows.Close()
	mapRows, err := tx.Query(r.Context(), `SELECT old_hold_id,new_hold_id FROM hold_matches WHERE wall_image_id=$1`, shared.PgUUID(imageID))
	if err != nil {
		writeError(w, 500, "could not load matches")
		return
	}
	matches := map[uuid.UUID]uuid.UUID{}
	for mapRows.Next() {
		var a, b uuid.UUID
		if mapRows.Scan(&a, &b) == nil {
			matches[a] = b
		}
	}
	mapRows.Close()
	kept := 0
	for _, route := range all {
		newIDs, newRoles, complete, mapErr := remapRouteHolds(route.ids, route.roles, matches)
		if mapErr != nil {
			writeError(w, 500, "invalid route roles")
			return
		}
		if complete {
			roles := []byte(newRoles)
			if len(roles) == 0 {
				roles = []byte(`{}`)
			}
			if _, err := tx.Exec(r.Context(), `UPDATE routes SET wall_image_id=$2,hold_ids=$3,hold_roles=$4 WHERE id=$1`, route.id, shared.PgUUID(imageID), newIDs, roles); err != nil {
				writeError(w, 500, "could not remap routes")
				return
			}
			kept++
		}
	}
	if _, err = tx.Exec(r.Context(), `UPDATE wall_images SET is_active=false WHERE wall_id=$1 AND is_active=true`, shared.PgUUID(wallID)); err == nil {
		_, err = tx.Exec(r.Context(), `UPDATE wall_images SET is_active=true,review_status='applied' WHERE id=$1`, shared.PgUUID(imageID))
	}
	if err != nil {
		writeError(w, 500, "could not activate reset")
		return
	}
	if err = tx.Commit(r.Context()); err != nil {
		writeError(w, 500, "could not commit reset")
		return
	}
	writeJSON(w, 200, map[string]int{"kept": kept, "archived": len(all) - kept})
}

func (h *Handler) DiscardReset(w http.ResponseWriter, r *http.Request) {
	wallID, imageID, ok := h.resetAccess(w, r)
	if !ok {
		return
	}
	var key string
	err := h.pool.QueryRow(r.Context(), `DELETE FROM wall_images WHERE id=$1 AND wall_id=$2 AND reset_kind='partial' AND review_status='pending' RETURNING storage_key`, shared.PgUUID(imageID), shared.PgUUID(wallID)).Scan(&key)
	if err != nil {
		writeError(w, 404, "pending reset not found")
		return
	}
	if h.storage != nil {
		if err := h.storage.Delete(r.Context(), key); err != nil {
			writeError(w, 500, "reset removed but image storage cleanup failed")
			return
		}
	}
	w.WriteHeader(http.StatusNoContent)
}
