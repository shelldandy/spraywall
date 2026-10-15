package user

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"

	"github.com/bowlinedandy/spraywall/server/db/generated"
)

const minPasswordLength = 8

// currentUser loads the authenticated user, writing an error response on
// failure.
func (h *Handler) currentUser(w http.ResponseWriter, r *http.Request) (generated.User, bool) {
	userID := GetUserID(r.Context())
	if userID == uuid.Nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return generated.User{}, false
	}
	u, err := h.queries.GetUserByID(r.Context(), pgUUID(userID))
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "user not found"})
		return generated.User{}, false
	}
	return u, true
}

// UpdateMe handles PATCH /users/me
func (h *Handler) UpdateMe(w http.ResponseWriter, r *http.Request) {
	u, ok := h.currentUser(w, r)
	if !ok {
		return
	}

	var req struct {
		DisplayName string `json:"display_name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}
	name := strings.TrimSpace(req.DisplayName)
	if name == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "display_name is required"})
		return
	}

	u, err := h.queries.UpdateUserDisplayName(r.Context(), generated.UpdateUserDisplayNameParams{
		ID:          u.ID,
		DisplayName: name,
	})
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
		return
	}
	h.writeMe(w, r.Context(), u)
}

// ChangePassword handles PUT /users/me/password. Users without a password
// (OIDC-only accounts) may set one without providing current_password.
func (h *Handler) ChangePassword(w http.ResponseWriter, r *http.Request) {
	if !h.opts.PasswordEnabled {
		writeJSON(w, http.StatusForbidden, errPasswordDisabled)
		return
	}

	u, ok := h.currentUser(w, r)
	if !ok {
		return
	}

	var req struct {
		CurrentPassword string `json:"current_password"`
		NewPassword     string `json:"new_password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}
	if len(req.NewPassword) < minPasswordLength {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "new password must be at least 8 characters"})
		return
	}
	if u.PasswordHash != "" {
		if err := bcrypt.CompareHashAndPassword([]byte(u.PasswordHash), []byte(req.CurrentPassword)); err != nil {
			// Not 401: the client treats 401 as an expired access token.
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "current password is incorrect"})
			return
		}
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(req.NewPassword), bcryptCost)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
		return
	}

	// Update the hash, revoke every existing session, and issue a fresh pair
	// for the caller atomically.
	tx, err := h.pool.Begin(r.Context())
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
		return
	}
	defer tx.Rollback(r.Context()) //nolint:errcheck

	txq := h.queries.WithTx(tx)
	if err := txq.UpdateUserPassword(r.Context(), generated.UpdateUserPasswordParams{
		ID:           u.ID,
		PasswordHash: string(hash),
	}); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
		return
	}
	if err := txq.DeleteRefreshTokensByUserID(r.Context(), u.ID); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
		return
	}
	tokens, err := h.IssueTokens(r.Context(), txq, u)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
		return
	}

	writeJSON(w, http.StatusOK, tokens)
}

// UploadAvatar handles POST /users/me/avatar (multipart field "avatar").
func (h *Handler) UploadAvatar(w http.ResponseWriter, r *http.Request) {
	u, ok := h.currentUser(w, r)
	if !ok {
		return
	}

	// Allow some headroom for multipart framing on top of the image itself.
	r.Body = http.MaxBytesReader(w, r.Body, MaxAvatarSize+(1<<20))
	file, _, err := r.FormFile("avatar")
	if err != nil {
		var maxErr *http.MaxBytesError
		if errors.As(err, &maxErr) {
			writeJSON(w, http.StatusRequestEntityTooLarge, map[string]string{"error": "avatar must be 5 MB or smaller"})
			return
		}
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "avatar file is required"})
		return
	}
	defer file.Close()

	data, err := io.ReadAll(io.LimitReader(file, MaxAvatarSize+1))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "could not read avatar"})
		return
	}
	if len(data) > MaxAvatarSize {
		writeJSON(w, http.StatusRequestEntityTooLarge, map[string]string{"error": "avatar must be 5 MB or smaller"})
		return
	}
	if _, _, ok := SniffAvatarType(data); !ok {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "avatar must be a JPEG, PNG, WebP, or GIF image"})
		return
	}

	u, err = SetAvatar(r.Context(), h.opts.Storage, h.queries, u, data, AvatarSourceUpload, "")
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not save avatar"})
		return
	}
	h.writeMe(w, r.Context(), u)
}

// DeleteAvatar handles DELETE /users/me/avatar
func (h *Handler) DeleteAvatar(w http.ResponseWriter, r *http.Request) {
	u, ok := h.currentUser(w, r)
	if !ok {
		return
	}

	u, err := ClearAvatar(r.Context(), h.opts.Storage, h.queries, u)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not remove avatar"})
		return
	}
	h.writeMe(w, r.Context(), u)
}

// hasLoginMethod reports whether a user can still sign in with the given
// password state and number of remaining linked identities.
func hasLoginMethod(hasPassword, passwordEnabled bool, remainingIdentities int64) bool {
	return (hasPassword && passwordEnabled) || remainingIdentities > 0
}

// UnlinkIdentity handles DELETE /users/me/identities/{id}
func (h *Handler) UnlinkIdentity(w http.ResponseWriter, r *http.Request) {
	u, ok := h.currentUser(w, r)
	if !ok {
		return
	}

	identityID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "identity not found"})
		return
	}

	// Delete and re-count in one transaction so concurrent unlinks cannot
	// both slip past the last-login-method guard.
	tx, err := h.pool.Begin(r.Context())
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
		return
	}
	defer tx.Rollback(r.Context()) //nolint:errcheck

	txq := h.queries.WithTx(tx)
	// Lock the user row to serialize unlinks for the same account.
	u, err = txq.GetUserByIDForUpdate(r.Context(), u.ID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
		return
	}

	deleted, err := txq.DeleteUserIdentity(r.Context(), generated.DeleteUserIdentityParams{
		ID:     pgUUID(identityID),
		UserID: u.ID,
	})
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
		return
	}
	if deleted == 0 {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "identity not found"})
		return
	}

	remaining, err := txq.CountUserIdentities(r.Context(), u.ID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
		return
	}
	if !hasLoginMethod(u.PasswordHash != "", h.opts.PasswordEnabled, remaining) {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "cannot unlink your only way to sign in; set a password first"})
		return
	}

	if err := tx.Commit(r.Context()); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
		return
	}
	h.writeMe(w, r.Context(), u)
}
