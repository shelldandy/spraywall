package invite

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	db "github.com/bowlinedandy/spraywall/server/db/generated"
	"github.com/bowlinedandy/spraywall/server/internal/shared"
	"github.com/bowlinedandy/spraywall/server/internal/user"
)

type Handler struct {
	queries *db.Queries
	pool    interface {
		Begin(context.Context) (pgx.Tx, error)
	}
}

func NewHandler(queries *db.Queries, pool interface {
	Begin(context.Context) (pgx.Tx, error)
}) *Handler {
	return &Handler{queries: queries, pool: pool}
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

// CreateInvite handles POST /invites.
func (h *Handler) CreateInvite(w http.ResponseWriter, r *http.Request) {
	userID := user.GetUserID(r.Context())
	if userID == uuid.Nil {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	if user.GetUserRole(r.Context()) != string(db.UserRoleAdmin) {
		writeError(w, http.StatusForbidden, "admin role required")
		return
	}

	var req struct {
		Role string `json:"role"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	role := db.UserRole(req.Role)
	if role != db.UserRoleAdmin && role != db.UserRoleSetter && role != db.UserRoleClimber {
		writeError(w, http.StatusBadRequest, "invalid role")
		return
	}

	tokenBytes := make([]byte, 32)
	if _, err := rand.Read(tokenBytes); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to generate token")
		return
	}
	invite, err := h.queries.CreateInvite(r.Context(), db.CreateInviteParams{
		Token: hex.EncodeToString(tokenBytes), CreatedBy: shared.PgUUID(userID), Role: role,
		ExpiresAt: shared.PgTimestamptz(time.Now().Add(7 * 24 * time.Hour)),
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create invite")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{
		"id": shared.UUIDFromPg(invite.ID).String(), "token": invite.Token,
		"role": string(invite.Role), "expires_at": invite.ExpiresAt.Time,
	})
}

// ValidateInvite handles GET /invites/{token}.
func (h *Handler) ValidateInvite(w http.ResponseWriter, r *http.Request) {
	invite, err := h.queries.GetInviteByToken(r.Context(), chi.URLParam(r, "token"))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, http.StatusNotFound, "invite not found or expired")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to look up invite")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"role": string(invite.Role), "expires_at": invite.ExpiresAt.Time,
	})
}

// AcceptInvite handles POST /invites/{token}/accept.
func (h *Handler) AcceptInvite(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	userID := user.GetUserID(ctx)
	if userID == uuid.Nil {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	invite, err := h.queries.GetInviteByToken(ctx, chi.URLParam(r, "token"))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, http.StatusNotFound, "invite not found or expired")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to look up invite")
		return
	}

	tx, err := h.pool.Begin(ctx)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to start transaction")
		return
	}
	defer tx.Rollback(ctx)
	txq := h.queries.WithTx(tx)
	consumed, err := txq.ConsumeInvite(ctx, db.ConsumeInviteParams{ID: invite.ID, UsedBy: shared.PgUUID(userID)})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to mark invite as used")
		return
	}
	if consumed != 1 {
		writeError(w, http.StatusConflict, "invite has already been used or expired")
		return
	}
	if err := txq.PromoteUserRole(ctx, db.PromoteUserRoleParams{ID: shared.PgUUID(userID), Role: invite.Role}); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to promote user role")
		return
	}
	if err := tx.Commit(ctx); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to commit transaction")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"role": string(invite.Role)})
}
