// Package wallaccess centralizes wall lookup for authenticated HTTP handlers.
package wallaccess

import (
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/bowlinedandy/spraywall/server/db/generated"
	"github.com/bowlinedandy/spraywall/server/internal/shared"
	"github.com/bowlinedandy/spraywall/server/internal/user"
)

func RequireWall(w http.ResponseWriter, r *http.Request, q *generated.Queries) (generated.Wall, generated.UserRole, error) {
	id, err := uuid.Parse(chi.URLParam(r, "wallId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid wall id")
		return generated.Wall{}, "", err
	}
	wall, err := q.GetWallByID(r.Context(), shared.PgUUID(id))
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "wall not found")
		return generated.Wall{}, "", err
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "database error")
		return generated.Wall{}, "", err
	}
	return wall, generated.UserRole(user.GetUserRole(r.Context())), nil
}

func writeError(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_, _ = w.Write([]byte(`{"error":"` + message + `"}`))
}
