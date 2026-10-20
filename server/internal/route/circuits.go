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

func (h *Handler) circuitWall(w http.ResponseWriter, r *http.Request) (pgtype.UUID, pgtype.UUID, generated.GymMember, bool) {
	gym, member, err := h.requireGymMember(w, r)
	if err != nil {
		return pgtype.UUID{}, pgtype.UUID{}, generated.GymMember{}, false
	}
	id, err := parseWallID(r)
	if err != nil {
		writeError(w, 400, "invalid wall id")
		return pgtype.UUID{}, pgtype.UUID{}, generated.GymMember{}, false
	}
	wallID := shared.PgUUID(id)
	wall, err := h.queries.GetWallByID(r.Context(), wallID)
	if errors.Is(err, pgx.ErrNoRows) || err == nil && wall.GymID != gym.ID {
		writeError(w, http.StatusNotFound, "wall not found")
		return pgtype.UUID{}, pgtype.UUID{}, generated.GymMember{}, false
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "database error")
		return pgtype.UUID{}, pgtype.UUID{}, generated.GymMember{}, false
	}
	return gym.ID, wallID, member, true
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
func (h *Handler) circuitScope(w http.ResponseWriter, r *http.Request) (circuitRow, pgtype.UUID, generated.GymMember, bool) {
	_, wall, member, ok := h.circuitWall(w, r)
	if !ok {
		return circuitRow{}, wall, member, false
	}
	id, err := uuid.Parse(chi.URLParam(r, "circuitId"))
	if err != nil {
		writeError(w, 400, "invalid circuit id")
		return circuitRow{}, wall, member, false
	}
	c, err := h.loadCircuit(r, id)
	if errors.Is(err, pgx.ErrNoRows) || err == nil && c.wall != uuidString(wall) {
		writeError(w, 404, "circuit not found")
		return c, wall, member, false
	}
	if err != nil {
		writeError(w, 500, "database error")
		return c, wall, member, false
	}
	uid := user.GetUserID(r.Context())
	if !c.shared && c.creator != uid.String() {
		writeError(w, 404, "circuit not found")
		return c, wall, member, false
	}
	return c, wall, member, true
}
func uuidString(id pgtype.UUID) string { return uuid.UUID(id.Bytes).String() }
func (h *Handler) ListCircuits(w http.ResponseWriter, r *http.Request) {
	_, wall, _, ok := h.circuitWall(w, r)
	if !ok {
		return
	}
	rows, err := h.queries.ListVisibleCircuitsByWall(r.Context(), generated.ListVisibleCircuitsByWallParams{
		ViewerID: shared.PgUUID(user.GetUserID(r.Context())), WallID: wall,
	})
	if err != nil {
		writeError(w, 500, "database error")
		return
	}
	viewerID := user.GetUserID(r.Context())
	out := make([]circuit, 0, len(rows))
	for _, row := range rows {
		out = append(out, circuit{
			ID: uuid.UUID(row.ID.Bytes).String(), WallID: uuid.UUID(row.WallID.Bytes).String(),
			CreatedBy: uuid.UUID(row.CreatedBy.Bytes).String(), CreatorName: row.CreatorName,
			Name: row.Name, IsShared: row.IsShared, IsOwner: row.CreatedBy == shared.PgUUID(viewerID),
			RouteIDs: row.RouteIds, CreatedAt: row.CreatedAt.Time, UpdatedAt: row.UpdatedAt.Time,
		})
	}
	writeJSON(w, 200, out)
}
func validateCircuitName(name string) (string, bool) {
	name = strings.TrimSpace(name)
	return name, utf8.RuneCountInString(name) >= 1 && utf8.RuneCountInString(name) <= 60
}

func (h *Handler) CreateCircuit(w http.ResponseWriter, r *http.Request) {
	_, wall, _, ok := h.circuitWall(w, r)
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
	defer func() { _ = tx.Rollback(r.Context()) }()
	uid := shared.PgUUID(user.GetUserID(r.Context()))
	for _, routeID := range ids {
		var routeWall pgtype.UUID
		var status, creator string
		err = tx.QueryRow(r.Context(), `SELECT wall_id,status,created_by::text FROM routes WHERE id=$1`, shared.PgUUID(routeID)).Scan(&routeWall, &status, &creator)
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, 400, "route is unavailable")
			return
		}
		if err != nil {
			writeError(w, 500, "database error")
			return
		}
		if routeWall != wall || (status != "published" && creator != user.GetUserID(r.Context()).String()) {
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
	c, _, _, ok := h.circuitScope(w, r)
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
	c, _, _, ok := h.circuitScope(w, r)
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
	c, _, member, ok := h.circuitScope(w, r)
	if !ok {
		return
	}
	if c.creator != user.GetUserID(r.Context()).String() && member.Role != generated.UserRoleAdmin {
		writeError(w, 403, "only the circuit owner or gym admin can delete a visible circuit")
		return
	}
	if err := h.queries.DeleteCircuit(r.Context(), mustUUID(c.id)); err != nil {
		writeError(w, 500, "database error")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
func (h *Handler) writeCircuitRoutes(w http.ResponseWriter, r *http.Request, replace bool) {
	c, _, _, ok := h.circuitScope(w, r)
	if !ok {
		return
	}
	if c.creator != user.GetUserID(r.Context()).String() {
		writeError(w, 403, "only the circuit owner can edit it")
		return
	}
	var requested []string
	if replace {
		var in struct {
			IDs *[]string `json:"route_ids"`
		}
		if json.NewDecoder(r.Body).Decode(&in) != nil || in.IDs == nil {
			writeError(w, 400, "request must include route_ids")
			return
		}
		requested = *in.IDs
	} else {
		var in struct {
			ID *string `json:"route_id"`
		}
		if json.NewDecoder(r.Body).Decode(&in) != nil || in.ID == nil || strings.TrimSpace(*in.ID) == "" {
			writeError(w, 400, "request must include route_id")
			return
		}
		requested = []string{*in.ID}
	}
	ids, valid := parseCircuitRouteIDs(requested)
	if !valid {
		writeError(w, 400, "route ids must be unique valid UUIDs (maximum 100)")
		return
	}
	if h.txPool == nil {
		writeError(w, 500, "transactions unavailable")
		return
	}
	tx, e := h.txPool.Begin(r.Context())
	if e != nil {
		writeError(w, 500, "database error")
		return
	}
	defer func() { _ = tx.Rollback(r.Context()) }()
	circuitID := mustUUID(c.id)
	var lockedID pgtype.UUID
	if e = tx.QueryRow(r.Context(), `SELECT id FROM circuits WHERE id=$1 FOR UPDATE`, circuitID).Scan(&lockedID); e != nil {
		writeError(w, 500, "database error")
		return
	}
	txQueries := h.queries.WithTx(tx)
	if replace {
		if e = txQueries.DeleteCircuitRoutes(r.Context(), circuitID); e != nil {
			writeError(w, 500, "database error")
			return
		}
	}
	for position, id := range ids {
		var wallID pgtype.UUID
		var status, creator string
		e = tx.QueryRow(r.Context(), `SELECT wall_id,status,created_by::text FROM routes WHERE id=$1`, shared.PgUUID(id)).Scan(&wallID, &status, &creator)
		if errors.Is(e, pgx.ErrNoRows) {
			writeError(w, 400, "route is unavailable")
			return
		}
		if e != nil {
			writeError(w, 500, "database error")
			return
		}
		if uuidString(wallID) != c.wall || status != "published" && creator != user.GetUserID(r.Context()).String() {
			writeError(w, 400, "route is unavailable")
			return
		}
		if replace {
			e = txQueries.InsertCircuitRoute(r.Context(), generated.InsertCircuitRouteParams{
				CircuitID: circuitID, RouteID: shared.PgUUID(id), Position: int32(position),
			})
		} else {
			var exists bool
			e = tx.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM circuit_routes WHERE circuit_id=$1 AND route_id=$2)`, circuitID, shared.PgUUID(id)).Scan(&exists)
			if e == nil && !exists {
				var count int
				e = tx.QueryRow(r.Context(), `SELECT count(*) FROM circuit_routes WHERE circuit_id=$1`, circuitID).Scan(&count)
				if e == nil && count >= 100 {
					writeError(w, 400, "a circuit can contain at most 100 routes")
					return
				}
			}
			if e == nil {
				e = txQueries.AppendCircuitRoute(r.Context(), generated.AppendCircuitRouteParams{
					CircuitID: circuitID, RouteID: shared.PgUUID(id),
				})
			}
		}
		if e != nil {
			writeError(w, 500, "database error")
			return
		}
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
	c, _, _, ok := h.circuitScope(w, r)
	if !ok {
		return
	}
	if c.creator != user.GetUserID(r.Context()).String() {
		writeError(w, 403, "only the circuit owner can edit it")
		return
	}
	id, e := uuid.Parse(chi.URLParam(r, "routeId"))
	if e != nil {
		writeError(w, 400, "invalid route id")
		return
	}
	e = h.queries.RemoveCircuitRoute(r.Context(), generated.RemoveCircuitRouteParams{
		CircuitID: mustUUID(c.id), RouteID: shared.PgUUID(id),
	})
	if e != nil {
		writeError(w, 500, "database error")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
