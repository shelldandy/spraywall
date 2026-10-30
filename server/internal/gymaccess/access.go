// Package gymaccess centralizes gym lookup and effective membership checks for HTTP handlers.
package gymaccess

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"

	"github.com/bowlinedandy/spraywall/server/db/generated"
	"github.com/bowlinedandy/spraywall/server/internal/user"
)

func writeError(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": message})
}

// RequireGymMember loads the requested gym and checks the authenticated user's
// effective membership. Missing gyms, non-members, and database failures retain
// distinct HTTP outcomes; callers still perform their own role-specific checks.
func RequireGymMember(w http.ResponseWriter, r *http.Request, queries *generated.Queries) (generated.Gym, generated.GymMember, error) {
	gym, err := queries.GetGymBySlug(r.Context(), chi.URLParam(r, "gymSlug"))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, http.StatusNotFound, "gym not found")
		} else {
			writeError(w, http.StatusInternalServerError, "database error")
		}
		return generated.Gym{}, generated.GymMember{}, err
	}

	member, err := user.EffectiveGymMember(r.Context(), queries, gym.ID)
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
