package route

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/bowlinedandy/spraywall/server/db/generated"
	"github.com/bowlinedandy/spraywall/server/internal/shared"
	"github.com/bowlinedandy/spraywall/server/internal/user"
)

type circuit struct {
	ID          string    `json:"id"`
	WallID      string    `json:"wall_id"`
	CreatedBy   string    `json:"created_by"`
	CreatorName string    `json:"creator_name"`
	Name        string    `json:"name"`
	IsShared    bool      `json:"is_shared"`
	IsOwner     bool      `json:"is_owner"`
	RouteIDs    []string  `json:"route_ids"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

type circuitRow struct {
	id, wall, creator, creatorName, name string
	shared                               bool
	created, updated                     time.Time
}

func (h *Handler) circuitWall(w http.ResponseWriter, r *http.Request) (pgtype.UUID, pgtype.UUID, bool) {
	gym, _, err := h.requireGymMember(w, r)
	if err != nil {
		return pgtype.UUID{}, pgtype.UUID{}, false
	}
	id, err := parseWallID(r)
	if err != nil {
		writeError(w, 400, "invalid wall id")
		return pgtype.UUID{}, pgtype.UUID{}, false
	}
	wallID := shared.PgUUID(id)
	wall, err := h.queries.GetWallByID(r.Context(), wallID)
	if err != nil || wall.GymID != gym.ID {
		writeError(w, http.StatusNotFound, "wall not found")
		return pgtype.UUID{}, pgtype.UUID{}, false
	}
	return gym.ID, wallID, true
}

func (h *Handler) loadCircuit(r *http.Request, id uuid.UUID) (circuitRow, error) {
	var c circuitRow
	err := h.db.QueryRow(r.Context(), `SELECT c.id::text,c.wall_id::text,c.created_by::text,u.display_name,c.name,c.is_shared,c.created_at,c.updated_at FROM circuits c JOIN users u ON u.id=c.created_by WHERE c.id=$1`, shared.PgUUID(id)).Scan(&c.id, &c.wall, &c.creator, &c.creatorName, &c.name, &c.shared, &c.created, &c.updated)
	return c, err
}
func (h *Handler) circuitJSON(r *http.Request, c circuitRow, owner bool) (circuit, error) {
	out := circuit{ID: c.id, WallID: c.wall, CreatedBy: c.creator, CreatorName: c.creatorName, Name: c.name, IsShared: c.shared, IsOwner: owner, RouteIDs: []string{}, CreatedAt: c.created, UpdatedAt: c.updated}
	rows, err := h.db.Query(r.Context(), `SELECT cr.route_id::text FROM circuit_routes cr JOIN routes rt ON rt.id=cr.route_id WHERE cr.circuit_id=$1 AND (rt.status='published' OR rt.created_by=$2) ORDER BY cr.position, cr.route_id`, mustUUID(c.id), shared.PgUUID(user.GetUserID(r.Context())))
	if err != nil {
		return out, err
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		if err = rows.Scan(&id); err != nil {
			return out, err
		}
		out.RouteIDs = append(out.RouteIDs, id)
	}
	return out, rows.Err()
}
func mustUUID(s string) pgtype.UUID { id, _ := uuid.Parse(s); return shared.PgUUID(id) }
func (h *Handler) circuitScope(w http.ResponseWriter, r *http.Request) (circuitRow, pgtype.UUID, bool) {
	_, wall, ok := h.circuitWall(w, r)
	if !ok {
		return circuitRow{}, wall, false
	}
	id, err := uuid.Parse(chi.URLParam(r, "circuitId"))
	if err != nil {
		writeError(w, 400, "invalid circuit id")
		return circuitRow{}, wall, false
	}
	c, err := h.loadCircuit(r, id)
	if errors.Is(err, pgx.ErrNoRows) || err == nil && c.wall != uuidString(wall) {
		writeError(w, 404, "circuit not found")
		return c, wall, false
	}
	if err != nil {
		writeError(w, 500, "database error")
		return c, wall, false
	}
	uid := user.GetUserID(r.Context())
	if !c.shared && c.creator != uid.String() {
		writeError(w, 404, "circuit not found")
		return c, wall, false
	}
	return c, wall, true
}
func uuidString(id pgtype.UUID) string { return uuid.UUID(id.Bytes).String() }
func (h *Handler) ListCircuits(w http.ResponseWriter, r *http.Request) {
	_, wall, ok := h.circuitWall(w, r)
	if !ok {
		return
	}
	rows, err := h.db.Query(r.Context(), `SELECT c.id::text,c.wall_id::text,c.created_by::text,u.display_name,c.name,c.is_shared,c.created_at,c.updated_at FROM circuits c JOIN users u ON u.id=c.created_by WHERE c.wall_id=$1 AND (c.is_shared OR c.created_by=$2) ORDER BY (c.created_by=$2) DESC, c.is_shared DESC, c.name`, wall, shared.PgUUID(user.GetUserID(r.Context())))
	if err != nil {
		writeError(w, 500, "database error")
		return
	}
	defer rows.Close()
	out := []circuit{}
	for rows.Next() {
		var c circuitRow
		if err = rows.Scan(&c.id, &c.wall, &c.creator, &c.creatorName, &c.name, &c.shared, &c.created, &c.updated); err != nil {
			writeError(w, 500, "database error")
			return
		}
		v, e := h.circuitJSON(r, c, c.creator == user.GetUserID(r.Context()).String())
		if e != nil {
			writeError(w, 500, "database error")
			return
		}
		out = append(out, v)
	}
	writeJSON(w, 200, out)
}
func validateCircuitName(name string) (string, bool) {
	name = strings.TrimSpace(name)
	return name, utf8.RuneCountInString(name) >= 1 && utf8.RuneCountInString(name) <= 60
}

func (h *Handler) CreateCircuit(w http.ResponseWriter, r *http.Request) {
	_, wall, ok := h.circuitWall(w, r)
	if !ok {
		return
	}
	var in struct {
		Name     string   `json:"name"`
		Shared   bool     `json:"is_shared"`
		RouteIDs []string `json:"route_ids"`
	}
	if json.NewDecoder(r.Body).Decode(&in) != nil {
		writeError(w, 400, "invalid request body")
		return
	}
	in.Name, ok = validateCircuitName(in.Name)
	if !ok {
		writeError(w, 400, "name must be 1-60 characters")
		return
	}
	ids, valid := parseCircuitRouteIDs(in.RouteIDs)
	if !valid {
		writeError(w, 400, "route ids must be unique valid UUIDs (maximum 100)")
		return
	}
	if h.txPool == nil {
		writeError(w, 500, "transactions unavailable")
		return
	}
	tx, err := h.txPool.Begin(r.Context())
	if err != nil {
		writeError(w, 500, "database error")
		return
	}
	defer tx.Rollback(r.Context())
	uid := shared.PgUUID(user.GetUserID(r.Context()))
	for _, routeID := range ids {
		var routeWall pgtype.UUID
		var status, creator string
		err = tx.QueryRow(r.Context(), `SELECT wall_id,status,created_by::text FROM routes WHERE id=$1`, shared.PgUUID(routeID)).Scan(&routeWall, &status, &creator)
		if err != nil || routeWall != wall || (status != "published" && creator != user.GetUserID(r.Context()).String()) {
			writeError(w, 400, "route is unavailable")
			return
		}
	}
	id := uuid.New()
	_, err = tx.Exec(r.Context(), `INSERT INTO circuits(id,wall_id,created_by,name,is_shared) VALUES($1,$2,$3,$4,$5)`, shared.PgUUID(id), wall, uid, in.Name, in.Shared)
	if err != nil {
		writeError(w, 500, "database error")
		return
	}
	for i, routeID := range ids {
		if _, err = tx.Exec(r.Context(), `INSERT INTO circuit_routes(circuit_id,route_id,position) VALUES($1,$2,$3)`, shared.PgUUID(id), shared.PgUUID(routeID), i); err != nil {
			writeError(w, 500, "database error")
			return
		}
	}
	if err = tx.Commit(r.Context()); err != nil {
		writeError(w, 500, "database error")
		return
	}
	created, err := h.loadCircuit(r, id)
	if err != nil {
		writeError(w, 500, "database error")
		return
	}
	out, err := h.circuitJSON(r, created, true)
	if err != nil {
		writeError(w, 500, "database error")
		return
	}
	writeJSON(w, 201, out)
}
func parseCircuitRouteIDs(values []string) ([]uuid.UUID, bool) {
	if len(values) > 100 {
		return nil, false
	}
	seen := make(map[uuid.UUID]bool, len(values))
	ids := make([]uuid.UUID, 0, len(values))
	for _, value := range values {
		id, err := uuid.Parse(value)
		if err != nil || seen[id] {
			return nil, false
		}
		seen[id] = true
		ids = append(ids, id)
	}
	return ids, true
}

func (h *Handler) GetCircuit(w http.ResponseWriter, r *http.Request) {
	c, _, ok := h.circuitScope(w, r)
	if !ok {
		return
	}
	out, err := h.circuitJSON(r, c, c.creator == user.GetUserID(r.Context()).String())
	if err != nil {
		writeError(w, 500, "database error")
		return
	}
	writeJSON(w, 200, out)
}
func (h *Handler) PatchCircuit(w http.ResponseWriter, r *http.Request) {
	c, _, ok := h.circuitScope(w, r)
	if !ok {
		return
	}
	if c.creator != user.GetUserID(r.Context()).String() {
		writeError(w, 403, "only the circuit owner can edit it")
		return
	}
	var in struct {
		Name   *string `json:"name"`
		Shared *bool   `json:"is_shared"`
	}
	if json.NewDecoder(r.Body).Decode(&in) != nil {
		writeError(w, 400, "invalid request body")
		return
	}
	name := c.name
	if in.Name != nil {
		name, _ = validateCircuitName(*in.Name)
	}
	sh := c.shared
	if in.Shared != nil {
		sh = *in.Shared
	}
	if _, valid := validateCircuitName(name); !valid {
		writeError(w, 400, "name must be 1-60 characters")
		return
	}
	_, err := h.db.Exec(r.Context(), `UPDATE circuits SET name=$2,is_shared=$3,updated_at=now() WHERE id=$1`, mustUUID(c.id), name, sh)
	if err != nil {
		writeError(w, 500, "database error")
		return
	}
	h.GetCircuit(w, r)
}
func (h *Handler) DeleteCircuit(w http.ResponseWriter, r *http.Request) {
	gym, member, err := h.requireGymMember(w, r)
	if err != nil {
		return
	}
	wallUUID, err := parseWallID(r)
	if err != nil {
		writeError(w, 400, "invalid wall id")
		return
	}
	wallID := shared.PgUUID(wallUUID)
	wall, err := h.queries.GetWallByID(r.Context(), wallID)
	if err != nil || wall.GymID != gym.ID {
		writeError(w, 404, "wall not found")
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "circuitId"))
	if err != nil {
		writeError(w, 400, "invalid circuit id")
		return
	}
	c, err := h.loadCircuit(r, id)
	if errors.Is(err, pgx.ErrNoRows) || err == nil && c.wall != uuidString(wallID) {
		writeError(w, 404, "circuit not found")
		return
	}
	if err != nil {
		writeError(w, 500, "database error")
		return
	}
	if c.creator != user.GetUserID(r.Context()).String() && member.Role != generated.UserRoleAdmin {
		writeError(w, 403, "only the circuit owner or gym admin can delete it")
		return
	}
	_, err = h.db.Exec(r.Context(), `DELETE FROM circuits WHERE id=$1`, mustUUID(c.id))
	if err != nil {
		writeError(w, 500, "database error")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
func (h *Handler) writeCircuitRoutes(w http.ResponseWriter, r *http.Request, replace bool) {
	c, _, ok := h.circuitScope(w, r)
	if !ok {
		return
	}
	if c.creator != user.GetUserID(r.Context()).String() {
		writeError(w, 403, "only the circuit owner can edit it")
		return
	}
	var in struct {
		IDs []string `json:"route_ids"`
		ID  string   `json:"route_id"`
	}
	if json.NewDecoder(r.Body).Decode(&in) != nil {
		writeError(w, 400, "invalid request body")
		return
	}
	if in.ID != "" {
		in.IDs = append(in.IDs, in.ID)
	}
	if len(in.IDs) > 100 {
		writeError(w, 400, "at most 100 routes are allowed")
		return
	}
	ids, valid := parseCircuitRouteIDs(in.IDs)
	if !valid {
		writeError(w, 400, "route ids must be unique valid UUIDs (maximum 100)")
		return
	}
	tx, e := h.txPool.Begin(r.Context())
	if e != nil {
		writeError(w, 500, "database error")
		return
	}
	defer tx.Rollback(r.Context())
	if replace {
		if _, e = tx.Exec(r.Context(), `DELETE FROM circuit_routes WHERE circuit_id=$1`, mustUUID(c.id)); e != nil {
			writeError(w, 500, "database error")
			return
		}
	}
	var position int
	if !replace {
		if e = tx.QueryRow(r.Context(), `SELECT COALESCE(max(position)+1,0) FROM circuit_routes WHERE circuit_id=$1`, mustUUID(c.id)).Scan(&position); e != nil {
			writeError(w, 500, "database error")
			return
		}
	}
	for _, id := range ids {
		var wallID pgtype.UUID
		var status, creator string
		e = tx.QueryRow(r.Context(), `SELECT wall_id,status,created_by::text FROM routes WHERE id=$1`, shared.PgUUID(id)).Scan(&wallID, &status, &creator)
		if e != nil || uuidString(wallID) != c.wall || status != "published" && creator != user.GetUserID(r.Context()).String() {
			writeError(w, 400, "route is unavailable")
			return
		}
		if replace {
			_, e = tx.Exec(r.Context(), `INSERT INTO circuit_routes(circuit_id,route_id,position) VALUES($1,$2,$3)`, mustUUID(c.id), shared.PgUUID(id), position)
		} else {
			_, e = tx.Exec(r.Context(), `INSERT INTO circuit_routes(circuit_id,route_id,position) VALUES($1,$2,$3) ON CONFLICT(circuit_id,route_id) DO NOTHING`, mustUUID(c.id), shared.PgUUID(id), position)
		}
		if e != nil {
			writeError(w, 500, "database error")
			return
		}
		position++
	}
	if e = tx.Commit(r.Context()); e != nil {
		writeError(w, 500, "database error")
		return
	}
	h.GetCircuit(w, r)
}
func (h *Handler) ReplaceCircuitRoutes(w http.ResponseWriter, r *http.Request) {
	h.writeCircuitRoutes(w, r, true)
}
func (h *Handler) AppendCircuitRoute(w http.ResponseWriter, r *http.Request) {
	h.writeCircuitRoutes(w, r, false)
}
func (h *Handler) DeleteCircuitRoute(w http.ResponseWriter, r *http.Request) {
	c, _, ok := h.circuitScope(w, r)
	if !ok {
		return
	}
	if c.creator != user.GetUserID(r.Context()).String() {
		writeError(w, 403, "only the circuit owner can edit it")
		return
	}
	var body struct {
		ID string `json:"route_id"`
	}
	if json.NewDecoder(r.Body).Decode(&body) != nil {
		writeError(w, 400, "invalid request body")
		return
	}
	id, e := uuid.Parse(body.ID)
	if e != nil {
		writeError(w, 400, "invalid route id")
		return
	}
	_, e = h.db.Exec(r.Context(), `DELETE FROM circuit_routes WHERE circuit_id=$1 AND route_id=$2`, mustUUID(c.id), shared.PgUUID(id))
	if e != nil {
		writeError(w, 500, "database error")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
