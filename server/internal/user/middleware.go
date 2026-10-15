package user

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/bowlinedandy/spraywall/server/db/generated"
)

type contextKey string

const (
	UserIDKey contextKey = "userID"
	// UserRoleKey holds the account's current effective role, not the
	// token's "role" claim.
	UserRoleKey contextKey = "userRole"
	// TokenVersionKey holds the access token's "ver" claim (0 if absent).
	TokenVersionKey contextKey = "tokenVersion"
	currentUserKey  contextKey = "currentUser"
)

// Authenticate validates the bearer token and loads its account. Tokens
// issued before the account's last session revocation are rejected, and the
// role comes from the account rather than the token, so revocations and
// demotions apply to outstanding access tokens immediately.
func (h *Handler) Authenticate(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		authHeader := r.Header.Get("Authorization")
		if authHeader == "" {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusUnauthorized)
			w.Write([]byte(`{"error":"missing authorization header"}`))
			return
		}

		parts := strings.SplitN(authHeader, " ", 2)
		if len(parts) != 2 || !strings.EqualFold(parts[0], "bearer") {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusUnauthorized)
			w.Write([]byte(`{"error":"invalid authorization header"}`))
			return
		}

		token, err := jwt.Parse(parts[1], func(token *jwt.Token) (interface{}, error) {
			if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
				return nil, jwt.ErrSignatureInvalid
			}
			return []byte(h.jwtSecret), nil
		})
		if err != nil || !token.Valid {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusUnauthorized)
			w.Write([]byte(`{"error":"invalid token"}`))
			return
		}

		claims, ok := token.Claims.(jwt.MapClaims)
		if !ok {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusUnauthorized)
			w.Write([]byte(`{"error":"invalid token claims"}`))
			return
		}

		sub, err := claims.GetSubject()
		if err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusUnauthorized)
			w.Write([]byte(`{"error":"invalid token subject"}`))
			return
		}

		userID, err := uuid.Parse(sub)
		if err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusUnauthorized)
			w.Write([]byte(`{"error":"invalid user ID in token"}`))
			return
		}

		u, err := h.queries.GetUserByID(r.Context(), pgUUID(userID))
		if errors.Is(err, pgx.ErrNoRows) {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "user not found"})
			return
		}
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
			return
		}
		ver, _ := claims["ver"].(float64)
		if int32(ver) != u.TokenVersion {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "session revoked"})
			return
		}

		// IssueTokens persists the demotion of an expired admin; until the
		// next issuance, treat the account as a climber.
		role := string(u.Role)
		if h.adminRoleExpired(u, time.Now()) {
			role = string(generated.UserRoleClimber)
		}

		ctx := context.WithValue(r.Context(), UserIDKey, userID)
		ctx = context.WithValue(ctx, UserRoleKey, role)
		ctx = context.WithValue(ctx, TokenVersionKey, int32(ver))
		ctx = context.WithValue(ctx, currentUserKey, u)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func GetUserID(ctx context.Context) uuid.UUID {
	id, _ := ctx.Value(UserIDKey).(uuid.UUID)
	return id
}

func GetUserRole(ctx context.Context) string {
	role, _ := ctx.Value(UserRoleKey).(string)
	return role
}

// CurrentUser returns the account Authenticate loaded for this request.
func CurrentUser(ctx context.Context) (generated.User, bool) {
	u, ok := ctx.Value(currentUserKey).(generated.User)
	return u, ok
}

// SessionCurrent reports whether the request's access token was issued after
// u's last session revocation. Authenticate checks it on every request;
// handlers that reload u later (e.g. under a lock) can check it again.
func SessionCurrent(ctx context.Context, u generated.User) bool {
	ver, _ := ctx.Value(TokenVersionKey).(int32)
	return ver == u.TokenVersion
}
