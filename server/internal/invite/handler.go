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
	"github.com/jackc/pgx/v5"

	db "github.com/bowlinedandy/spraywall/server/db/generated"
	"github.com/bowlinedandy/spraywall/server/internal/shared"
	"github.com/bowlinedandy/spraywall/server/internal/user"

	"github.com/google/uuid"
)

type Handler struct {
	queries *db.Queries
	pool    interface{ Begin(context.Context) (pgx.Tx, error) }
}

func NewHandler(queries *db.Queries, pool interface{ Begin(context.Context) (pgx.Tx, error) }) *Handler {
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

// CreateInvite handles POST /gyms/{gymSlug}/invites
func (h *Handler) CreateInvite(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	userID := user.GetUserID(ctx)
	if userID == uuid.Nil {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	gymSlug := chi.URLParam(r, "gymSlug")
	gym, err := h.queries.GetGymBySlug(ctx, gymSlug)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, http.StatusNotFound, "gym not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to look up gym")
		return
	}

	member, err := h.queries.GetGymMember(ctx, db.GetGymMemberParams{
		GymID:  gym.ID,
		UserID: shared.PgUUID(userID),
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, http.StatusForbidden, "not a member of this gym")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to check membership")
		return
	}
	if member.Role != db.UserRoleAdmin {
		writeError(w, http.StatusForbidden, "admin role required")
		return
	}

	var req struct {
		Role string `json:"role"`
	}
	if r.Body != nil {
		_ = json.NewDecoder(r.Body).Decode(&req)
	}
	role := db.UserRoleClimber
	if req.Role != "" {
		switch db.UserRole(req.Role) {
		case db.UserRoleAdmin, db.UserRoleSetter, db.UserRoleClimber:
			role = db.UserRole(req.Role)
		default:
			writeError(w, http.StatusBadRequest, "invalid role")
			return
		}
	}

	tokenBytes := make([]byte, 32)
	if _, err := rand.Read(tokenBytes); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to generate token")
		return
	}
	token := hex.EncodeToString(tokenBytes)

	invite, err := h.queries.CreateInvite(ctx, db.CreateInviteParams{
		GymID:     gym.ID,
		Token:     token,
		CreatedBy: shared.PgUUID(userID),
		Role:      role,
		ExpiresAt: shared.PgTimestamptz(time.Now().Add(7 * 24 * time.Hour)),
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create invite")
		return
	}

	writeJSON(w, http.StatusCreated, map[string]any{
		"id":         shared.UUIDFromPg(invite.ID).String(),
		"token":      invite.Token,
		"role":       string(invite.Role),
		"expires_at": invite.ExpiresAt.Time,
	})
}

// ValidateInvite handles GET /invites/{token}
func (h *Handler) ValidateInvite(w http.ResponseWriter, r *http.Request) {
	token := chi.URLParam(r, "token")
	invite, err := h.queries.GetInviteByToken(r.Context(), token)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, http.StatusNotFound, "invite not found or expired")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to look up invite")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"gym_name":   invite.GymName,
		"gym_slug":   invite.GymSlug,
		"role":       string(invite.Role),
		"expires_at": invite.ExpiresAt.Time,
	})
}

// AcceptInvite handles POST /invites/{token}/accept
func (h *Handler) AcceptInvite(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	userID := user.GetUserID(ctx)
	if userID == uuid.Nil {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	token := chi.URLParam(r, "token")
	invite, err := h.queries.GetInviteByToken(ctx, token)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, http.StatusNotFound, "invite not found or expired")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to look up invite")
		return
	}

	// Check if already a member
	_, err = h.queries.GetGymMember(ctx, db.GetGymMemberParams{
		GymID:  invite.GymID,
		UserID: shared.PgUUID(userID),
	})
	if err == nil {
		writeError(w, http.StatusConflict, "already a member of this gym")
		return
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusInternalServerError, "failed to check membership")
		return
	}

	// Add member and mark invite as used in a single transaction.
	tx, err := h.pool.Begin(ctx)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to start transaction")
		return
	}
	defer tx.Rollback(ctx)

	txq := h.queries.WithTx(tx)

	err = txq.CreateGymMember(ctx, db.CreateGymMemberParams{
		GymID:  invite.GymID,
		UserID: shared.PgUUID(userID),
		Role:   invite.Role,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to add gym member")
		return
	}

	err = txq.UseInvite(ctx, db.UseInviteParams{
		ID:     invite.ID,
		UsedBy: shared.PgUUID(userID),
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to mark invite as used")
		return
	}

	if err := tx.Commit(ctx); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to commit transaction")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"gym_name": invite.GymName,
		"gym_slug": invite.GymSlug,
		"role":     string(invite.Role),
	})
}
