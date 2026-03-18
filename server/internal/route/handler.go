package route

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/bowlinedandy/spraywall/server/db/generated"
	"github.com/bowlinedandy/spraywall/server/internal/shared"
	"github.com/bowlinedandy/spraywall/server/internal/user"
)

// Handler holds dependencies for route HTTP handlers.
type Handler struct {
	queries *generated.Queries
}

// NewHandler creates a new Handler.
func NewHandler(queries *generated.Queries) *Handler {
	return &Handler{queries: queries}
}

// ---------- helpers ----------

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v) //nolint:errcheck
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

// requireGymMember loads the gym by slug, verifies the caller is a member,
// and returns the gym and membership. If the check fails it writes an HTTP
// error and returns a non-nil error.
func (h *Handler) requireGymMember(w http.ResponseWriter, r *http.Request) (generated.Gym, generated.GymMember, error) {
	gymSlug := chi.URLParam(r, "gymSlug")
	gym, err := h.queries.GetGymBySlug(r.Context(), gymSlug)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, http.StatusNotFound, "gym not found")
		} else {
			writeError(w, http.StatusInternalServerError, "database error")
		}
		return generated.Gym{}, generated.GymMember{}, err
	}

	userID := user.GetUserID(r.Context())
	member, err := h.queries.GetGymMember(r.Context(), generated.GetGymMemberParams{
		GymID:  gym.ID,
		UserID: shared.PgUUID(userID),
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, http.StatusForbidden, "not a member of this gym")
		} else {
			writeError(w, http.StatusInternalServerError, "database error")
		}
		return generated.Gym{}, generated.GymMember{}, err
	}

	return gym, member, nil
}

// parseWallID extracts and parses the wallId URL param.
func parseWallID(r *http.Request) (uuid.UUID, error) {
	return uuid.Parse(chi.URLParam(r, "wallId"))
}

// parseRouteID extracts and parses the routeId URL param.
func parseRouteID(r *http.Request) (uuid.UUID, error) {
	return uuid.Parse(chi.URLParam(r, "routeId"))
}

// ---------- response types ----------

type routeResponse struct {
	generated.Route
	HoldRoles json.RawMessage `json:"hold_roles"`
	SendCount int             `json:"send_count"`
	HasSent   bool            `json:"has_sent"`
	IsLegacy  bool            `json:"is_legacy"`
}

// ---------- endpoints ----------

// CreateRoute handles POST /gyms/{gymSlug}/walls/{wallId}/routes
func (h *Handler) CreateRoute(w http.ResponseWriter, r *http.Request) {
	gym, _, err := h.requireGymMember(w, r)
	if err != nil {
		return
	}

	wallUUID, err := parseWallID(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid wall id")
		return
	}
	pgWallID := shared.PgUUID(wallUUID)

	// Verify wall exists.
	wall, err := h.queries.GetWallByID(r.Context(), pgWallID)
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

	var body struct {
		Name        string           `json:"name"`
		Grade       *string          `json:"grade"`
		Description *string          `json:"description"`
		HoldIDs     []string         `json:"hold_ids"`
		HoldRoles   *json.RawMessage `json:"hold_roles"`
		Status      string           `json:"status"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if body.Name == "" {
		writeError(w, http.StatusBadRequest, "name is required")
		return
	}
	if len(body.HoldIDs) < 2 {
		writeError(w, http.StatusBadRequest, "at least 2 holds are required")
		return
	}

	// Parse hold UUIDs.
	holdIDs := make([]pgtype.UUID, len(body.HoldIDs))
	for i, idStr := range body.HoldIDs {
		parsed, err := uuid.Parse(idStr)
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid hold id: "+idStr)
			return
		}
		holdIDs[i] = shared.PgUUID(parsed)
	}

	// Get active wall image.
	img, err := h.queries.GetActiveWallImage(r.Context(), pgWallID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, http.StatusBadRequest, "wall has no active image")
		} else {
			writeError(w, http.StatusInternalServerError, "database error")
		}
		return
	}

	// Validate hold IDs belong to this wall image.
	existingHolds, err := h.queries.GetHoldsByWallImage(r.Context(), img.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "database error")
		return
	}
	validHoldIDs := make(map[pgtype.UUID]bool, len(existingHolds))
	for _, eh := range existingHolds {
		validHoldIDs[eh.ID] = true
	}
	for _, hid := range holdIDs {
		if !validHoldIDs[hid] {
			writeError(w, http.StatusBadRequest, "one or more hold IDs do not belong to the active wall image")
			return
		}
	}

	userID := user.GetUserID(r.Context())

	status := "published"
	if body.Status == "draft" {
		status = "draft"
	}

	var grade pgtype.Text
	if body.Grade != nil {
		grade = pgtype.Text{String: *body.Grade, Valid: true}
	}
	var description pgtype.Text
	if body.Description != nil {
		description = pgtype.Text{String: *body.Description, Valid: true}
	}

	var holdRoles []byte
	if body.HoldRoles != nil {
		holdRoles = []byte(*body.HoldRoles)
	}

	route, err := h.queries.CreateRoute(r.Context(), generated.CreateRouteParams{
		WallID:      pgWallID,
		WallImageID: img.ID,
		CreatedBy:   shared.PgUUID(userID),
		Name:        body.Name,
		Grade:       grade,
		Description: description,
		HoldIds:     holdIDs,
		HoldRoles:   holdRoles,
		Status:      status,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not create route")
		return
	}

	writeJSON(w, http.StatusCreated, routeResponse{
		Route:     route,
		HoldRoles: json.RawMessage(route.HoldRoles),
		SendCount: 0,
		HasSent:   false,
	})
}

// ListRoutes handles GET /gyms/{gymSlug}/walls/{wallId}/routes
func (h *Handler) ListRoutes(w http.ResponseWriter, r *http.Request) {
	gym, _, err := h.requireGymMember(w, r)
	if err != nil {
		return
	}

	wallUUID, err := parseWallID(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid wall id")
		return
	}
	pgWallID := shared.PgUUID(wallUUID)

	wall, err := h.queries.GetWallByID(r.Context(), pgWallID)
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

	routes, err := h.queries.ListRoutesByWall(r.Context(), generated.ListRoutesByWallParams{
		WallID:    pgWallID,
		CreatedBy: shared.PgUUID(user.GetUserID(r.Context())),
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not list routes")
		return
	}

	// Get active wall image to determine legacy status.
	activeImg, activeImgErr := h.queries.GetActiveWallImage(r.Context(), pgWallID)
	if activeImgErr != nil && !errors.Is(activeImgErr, pgx.ErrNoRows) {
		writeError(w, http.StatusInternalServerError, "database error")
		return
	}

	userID := user.GetUserID(r.Context())
	pgUserID := shared.PgUUID(userID)

	result := make([]routeResponse, 0, len(routes))
	for _, rt := range routes {
		count, err := h.queries.CountSendsByRoute(r.Context(), rt.ID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "database error")
			return
		}

		_, sendErr := h.queries.GetSendByUser(r.Context(), generated.GetSendByUserParams{
			RouteID: rt.ID,
			UserID:  pgUserID,
		})
		hasSent := sendErr == nil

		isLegacy := errors.Is(activeImgErr, pgx.ErrNoRows) || rt.WallImageID != activeImg.ID

		result = append(result, routeResponse{
			Route:     rt,
			HoldRoles: json.RawMessage(rt.HoldRoles),
			SendCount: int(count),
			HasSent:   hasSent,
			IsLegacy:  isLegacy,
		})
	}

	writeJSON(w, http.StatusOK, result)
}

// GetRoute handles GET /gyms/{gymSlug}/walls/{wallId}/routes/{routeId}
func (h *Handler) GetRoute(w http.ResponseWriter, r *http.Request) {
	gym, _, err := h.requireGymMember(w, r)
	if err != nil {
		return
	}

	routeUUID, err := parseRouteID(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid route id")
		return
	}

	rt, err := h.queries.GetRouteByID(r.Context(), shared.PgUUID(routeUUID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, http.StatusNotFound, "route not found")
		} else {
			writeError(w, http.StatusInternalServerError, "database error")
		}
		return
	}

	wall, err := h.queries.GetWallByID(r.Context(), rt.WallID)
	if err != nil || wall.GymID != gym.ID {
		writeError(w, http.StatusNotFound, "route not found")
		return
	}

	count, err := h.queries.CountSendsByRoute(r.Context(), rt.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "database error")
		return
	}

	userID := user.GetUserID(r.Context())
	_, sendErr := h.queries.GetSendByUser(r.Context(), generated.GetSendByUserParams{
		RouteID: rt.ID,
		UserID:  shared.PgUUID(userID),
	})

	// Determine legacy status.
	activeImg, activeImgErr := h.queries.GetActiveWallImage(r.Context(), rt.WallID)
	if activeImgErr != nil && !errors.Is(activeImgErr, pgx.ErrNoRows) {
		writeError(w, http.StatusInternalServerError, "database error")
		return
	}
	isLegacy := errors.Is(activeImgErr, pgx.ErrNoRows) || rt.WallImageID != activeImg.ID

	writeJSON(w, http.StatusOK, routeResponse{
		Route:     rt,
		HoldRoles: json.RawMessage(rt.HoldRoles),
		SendCount: int(count),
		HasSent:   sendErr == nil,
		IsLegacy:  isLegacy,
	})
}

// UpdateRoute handles PUT /gyms/{gymSlug}/walls/{wallId}/routes/{routeId}
func (h *Handler) UpdateRoute(w http.ResponseWriter, r *http.Request) {
	gym, _, err := h.requireGymMember(w, r)
	if err != nil {
		return
	}

	routeUUID, err := parseRouteID(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid route id")
		return
	}
	pgRouteID := shared.PgUUID(routeUUID)

	rt, err := h.queries.GetRouteByID(r.Context(), pgRouteID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, http.StatusNotFound, "route not found")
		} else {
			writeError(w, http.StatusInternalServerError, "database error")
		}
		return
	}

	wall, err := h.queries.GetWallByID(r.Context(), rt.WallID)
	if err != nil || wall.GymID != gym.ID {
		writeError(w, http.StatusNotFound, "route not found")
		return
	}

	// Only the creator can edit.
	userID := user.GetUserID(r.Context())
	if rt.CreatedBy != shared.PgUUID(userID) {
		writeError(w, http.StatusForbidden, "only the route creator can edit")
		return
	}

	var body struct {
		Name        string           `json:"name"`
		Grade       *string          `json:"grade"`
		Description *string          `json:"description"`
		HoldIDs     []string         `json:"hold_ids"`
		HoldRoles   *json.RawMessage `json:"hold_roles"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if body.Name == "" {
		writeError(w, http.StatusBadRequest, "name is required")
		return
	}
	if len(body.HoldIDs) < 2 {
		writeError(w, http.StatusBadRequest, "at least 2 holds are required")
		return
	}

	holdIDs := make([]pgtype.UUID, len(body.HoldIDs))
	for i, idStr := range body.HoldIDs {
		parsed, err := uuid.Parse(idStr)
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid hold id: "+idStr)
			return
		}
		holdIDs[i] = shared.PgUUID(parsed)
	}

	var grade pgtype.Text
	if body.Grade != nil {
		grade = pgtype.Text{String: *body.Grade, Valid: true}
	}
	var description pgtype.Text
	if body.Description != nil {
		description = pgtype.Text{String: *body.Description, Valid: true}
	}
	var holdRoles []byte
	if body.HoldRoles != nil {
		holdRoles = []byte(*body.HoldRoles)
	}

	updated, err := h.queries.UpdateRoute(r.Context(), generated.UpdateRouteParams{
		ID:          pgRouteID,
		Name:        body.Name,
		Grade:       grade,
		Description: description,
		HoldIds:     holdIDs,
		HoldRoles:   holdRoles,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not update route")
		return
	}

	writeJSON(w, http.StatusOK, routeResponse{
		Route:     updated,
		HoldRoles: json.RawMessage(updated.HoldRoles),
	})
}

// DeleteRoute handles DELETE /gyms/{gymSlug}/walls/{wallId}/routes/{routeId}
func (h *Handler) DeleteRoute(w http.ResponseWriter, r *http.Request) {
	gym, member, err := h.requireGymMember(w, r)
	if err != nil {
		return
	}

	routeUUID, err := parseRouteID(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid route id")
		return
	}
	pgRouteID := shared.PgUUID(routeUUID)

	rt, err := h.queries.GetRouteByID(r.Context(), pgRouteID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, http.StatusNotFound, "route not found")
		} else {
			writeError(w, http.StatusInternalServerError, "database error")
		}
		return
	}

	wall, err := h.queries.GetWallByID(r.Context(), rt.WallID)
	if err != nil || wall.GymID != gym.ID {
		writeError(w, http.StatusNotFound, "route not found")
		return
	}

	// Only the creator, a setter, or an admin can delete.
	userID := user.GetUserID(r.Context())
	isCreator := rt.CreatedBy == shared.PgUUID(userID)
	isPrivileged := member.Role == generated.UserRoleSetter || member.Role == generated.UserRoleAdmin
	if !isCreator && !isPrivileged {
		writeError(w, http.StatusForbidden, "only the route creator, setters, or admins can delete routes")
		return
	}

	if err := h.queries.DeleteRoute(r.Context(), pgRouteID); err != nil {
		writeError(w, http.StatusInternalServerError, "could not delete route")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// LogSend handles POST /gyms/{gymSlug}/walls/{wallId}/routes/{routeId}/sends
func (h *Handler) LogSend(w http.ResponseWriter, r *http.Request) {
	gym, _, err := h.requireGymMember(w, r)
	if err != nil {
		return
	}

	routeUUID, err := parseRouteID(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid route id")
		return
	}
	pgRouteID := shared.PgUUID(routeUUID)

	// Verify route exists.
	rt, err := h.queries.GetRouteByID(r.Context(), pgRouteID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, http.StatusNotFound, "route not found")
		} else {
			writeError(w, http.StatusInternalServerError, "database error")
		}
		return
	}

	wall, err := h.queries.GetWallByID(r.Context(), rt.WallID)
	if err != nil || wall.GymID != gym.ID {
		writeError(w, http.StatusNotFound, "route not found")
		return
	}

	// Block sends on legacy routes.
	activeImg, activeImgErr := h.queries.GetActiveWallImage(r.Context(), rt.WallID)
	if activeImgErr != nil {
		if errors.Is(activeImgErr, pgx.ErrNoRows) {
			writeError(w, http.StatusBadRequest, "cannot log send on legacy route")
		} else {
			writeError(w, http.StatusInternalServerError, "database error")
		}
		return
	}
	if rt.WallImageID != activeImg.ID {
		writeError(w, http.StatusBadRequest, "cannot log send on legacy route")
		return
	}

	// Block sends on draft routes.
	if rt.Status == "draft" {
		writeError(w, http.StatusBadRequest, "cannot log send on draft route")
		return
	}

	var body struct {
		Attempts *int32  `json:"attempts"`
		Notes    *string `json:"notes"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil && !errors.Is(err, io.EOF) {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	userID := user.GetUserID(r.Context())
	pgUserID := shared.PgUUID(userID)

	// Check if already sent.
	_, err = h.queries.GetSendByUser(r.Context(), generated.GetSendByUserParams{
		RouteID: pgRouteID,
		UserID:  pgUserID,
	})
	if err == nil {
		writeError(w, http.StatusConflict, "route already sent")
		return
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusInternalServerError, "database error")
		return
	}

	var attempts pgtype.Int4
	if body.Attempts != nil {
		attempts = pgtype.Int4{Int32: *body.Attempts, Valid: true}
	}
	var notes pgtype.Text
	if body.Notes != nil {
		notes = pgtype.Text{String: *body.Notes, Valid: true}
	}

	send, err := h.queries.CreateSend(r.Context(), generated.CreateSendParams{
		RouteID:  pgRouteID,
		UserID:   pgUserID,
		Attempts: attempts,
		Notes:    notes,
	})
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			writeError(w, http.StatusConflict, "route already sent")
			return
		}
		writeError(w, http.StatusInternalServerError, "could not log send")
		return
	}

	writeJSON(w, http.StatusCreated, send)
}

// RemoveSend handles DELETE /gyms/{gymSlug}/walls/{wallId}/routes/{routeId}/sends/me
func (h *Handler) RemoveSend(w http.ResponseWriter, r *http.Request) {
	gym, _, err := h.requireGymMember(w, r)
	if err != nil {
		return
	}

	routeUUID, err := parseRouteID(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid route id")
		return
	}

	rt, err := h.queries.GetRouteByID(r.Context(), shared.PgUUID(routeUUID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, http.StatusNotFound, "route not found")
		} else {
			writeError(w, http.StatusInternalServerError, "database error")
		}
		return
	}
	wall, err := h.queries.GetWallByID(r.Context(), rt.WallID)
	if err != nil || wall.GymID != gym.ID {
		writeError(w, http.StatusNotFound, "route not found")
		return
	}

	userID := user.GetUserID(r.Context())

	if err := h.queries.DeleteSendByUser(r.Context(), generated.DeleteSendByUserParams{
		RouteID: shared.PgUUID(routeUUID),
		UserID:  shared.PgUUID(userID),
	}); err != nil {
		writeError(w, http.StatusInternalServerError, "could not remove send")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// PublishRoute handles PATCH /gyms/{gymSlug}/walls/{wallId}/routes/{routeId}/publish
func (h *Handler) PublishRoute(w http.ResponseWriter, r *http.Request) {
	gym, _, err := h.requireGymMember(w, r)
	if err != nil {
		return
	}

	routeUUID, err := parseRouteID(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid route id")
		return
	}
	pgRouteID := shared.PgUUID(routeUUID)

	rt, err := h.queries.GetRouteByID(r.Context(), pgRouteID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, http.StatusNotFound, "route not found")
		} else {
			writeError(w, http.StatusInternalServerError, "database error")
		}
		return
	}

	wall, err := h.queries.GetWallByID(r.Context(), rt.WallID)
	if err != nil || wall.GymID != gym.ID {
		writeError(w, http.StatusNotFound, "route not found")
		return
	}

	// Only creator can publish their draft.
	userID := user.GetUserID(r.Context())
	if rt.CreatedBy != shared.PgUUID(userID) {
		writeError(w, http.StatusForbidden, "only the route creator can publish")
		return
	}

	if err := h.queries.UpdateRouteStatus(r.Context(), generated.UpdateRouteStatusParams{
		ID:     pgRouteID,
		Status: "published",
	}); err != nil {
		writeError(w, http.StatusInternalServerError, "could not publish route")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// Logbook handles GET /users/me/logbook
func (h *Handler) Logbook(w http.ResponseWriter, r *http.Request) {
	userID := user.GetUserID(r.Context())

	sends, err := h.queries.ListSendsByUser(r.Context(), shared.PgUUID(userID))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not fetch logbook")
		return
	}
	if sends == nil {
		sends = []generated.ListSendsByUserRow{}
	}

	writeJSON(w, http.StatusOK, sends)
}
