package user

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"golang.org/x/crypto/bcrypt"

	"github.com/bowlinedandy/spraywall/server/db/generated"
)

const (
	accessTokenDuration  = 15 * time.Minute
	refreshTokenDuration = 30 * 24 * time.Hour
	bcryptCost           = 12
)

// TxBeginner starts database transactions (satisfied by *pgxpool.Pool).
type TxBeginner interface {
	Begin(context.Context) (pgx.Tx, error)
}

// Options configures optional Handler features.
type Options struct {
	// PasswordEnabled allows email/password registration, login, and
	// password changes.
	PasswordEnabled bool
	// Storage holds avatar images. Required for avatar endpoints.
	Storage AvatarStorage
	// OIDCIssuer and OIDCProviderName label linked identities in /auth/me.
	OIDCIssuer       string
	OIDCProviderName string
	// AdminRoleMaxAge, when non-zero, demotes admins whose role was last
	// confirmed by an SSO login longer ago than this (see oidc.Config).
	AdminRoleMaxAge time.Duration
}

type Handler struct {
	queries   *generated.Queries
	jwtSecret string
	pool      TxBeginner
	opts      Options
}

func NewHandler(queries *generated.Queries, jwtSecret string, pool TxBeginner, opts Options) *Handler {
	return &Handler{queries: queries, jwtSecret: jwtSecret, pool: pool, opts: opts}
}

type registerRequest struct {
	Email       string `json:"email"`
	Password    string `json:"password"`
	DisplayName string `json:"display_name"`
}

type loginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type refreshRequest struct {
	RefreshToken string `json:"refresh_token"`
}

// TokenPair is the JSON body returned by every endpoint that issues tokens.
type TokenPair struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
}

type identityResponse struct {
	ID           uuid.UUID `json:"id"`
	Issuer       string    `json:"issuer"`
	ProviderName string    `json:"provider_name"`
	Email        string    `json:"email"`
	CreatedAt    time.Time `json:"created_at"`
}

type userResponse struct {
	ID          uuid.UUID          `json:"id"`
	Email       string             `json:"email"`
	DisplayName string             `json:"display_name"`
	Role        string             `json:"role"`
	CreatedAt   time.Time          `json:"created_at"`
	AvatarURL   *string            `json:"avatar_url"`
	HasPassword bool               `json:"has_password"`
	Identities  []identityResponse `json:"identities"`
}

var errPasswordDisabled = map[string]string{"error": "password login disabled"}

func (h *Handler) Register(w http.ResponseWriter, r *http.Request) {
	if !h.opts.PasswordEnabled {
		writeJSON(w, http.StatusForbidden, errPasswordDisabled)
		return
	}

	var req registerRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}

	if req.Email == "" || req.Password == "" || req.DisplayName == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "email, password, and display_name are required"})
		return
	}

	// The unique constraint is case-sensitive; emails are matched without case.
	if _, err := h.queries.GetUserByEmail(r.Context(), req.Email); err == nil {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "email already registered"})
		return
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcryptCost)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
		return
	}

	u, err := h.queries.CreateUser(r.Context(), generated.CreateUserParams{
		Email:        req.Email,
		PasswordHash: string(hash),
		DisplayName:  req.DisplayName,
		Role:         generated.UserRoleClimber,
	})
	if err != nil {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "email already registered"})
		return
	}

	tokens, err := h.IssueTokens(r.Context(), h.queries, u)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
		return
	}

	writeJSON(w, http.StatusCreated, tokens)
}

func (h *Handler) Login(w http.ResponseWriter, r *http.Request) {
	if !h.opts.PasswordEnabled {
		writeJSON(w, http.StatusForbidden, errPasswordDisabled)
		return
	}

	var req loginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}

	u, err := h.queries.GetUserByEmail(r.Context(), req.Email)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid credentials"})
		return
	}

	// OIDC-only accounts have no password hash and can never log in here.
	if u.PasswordHash == "" {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid credentials"})
		return
	}

	if err := bcrypt.CompareHashAndPassword([]byte(u.PasswordHash), []byte(req.Password)); err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid credentials"})
		return
	}

	tokens, err := h.IssueTokens(r.Context(), h.queries, u)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
		return
	}

	writeJSON(w, http.StatusOK, tokens)
}

func (h *Handler) Refresh(w http.ResponseWriter, r *http.Request) {
	var req refreshRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}

	// Revoke old token and generate new ones in a transaction. Consuming the
	// token with a single DELETE ... RETURNING means concurrent refreshes (or
	// a concurrent session revocation) can't both succeed.
	tx, err := h.pool.Begin(r.Context())
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
		return
	}
	defer tx.Rollback(r.Context())

	txq := h.queries.WithTx(tx)

	rt, err := txq.ConsumeRefreshToken(r.Context(), hashToken(req.RefreshToken))
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid refresh token"})
		return
	}

	u, err := txq.GetUserByID(r.Context(), rt.UserID)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "user not found"})
		return
	}
	if rt.TokenVersion != u.TokenVersion {
		// Consumed anyway: commit so the stale token can't be retried.
		if err := tx.Commit(r.Context()); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
			return
		}
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid refresh token"})
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

func (h *Handler) Logout(w http.ResponseWriter, r *http.Request) {
	var req refreshRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}

	tokenHash := hashToken(req.RefreshToken)
	rt, err := h.queries.GetRefreshTokenByHash(r.Context(), tokenHash)
	if err != nil {
		// Token already revoked or invalid — still return 200
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
		return
	}

	if err := h.queries.DeleteRefreshToken(r.Context(), rt.ID); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (h *Handler) Me(w http.ResponseWriter, r *http.Request) {
	u, ok := h.currentUser(w, r)
	if !ok {
		return
	}
	h.writeMe(w, r.Context(), u)
}

// writeMe renders the full /auth/me representation of u.
func (h *Handler) writeMe(w http.ResponseWriter, ctx context.Context, u generated.User) {
	resp, err := h.buildMe(ctx, u)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
		return
	}
	writeJSON(w, http.StatusOK, resp)
}

func (h *Handler) buildMe(ctx context.Context, u generated.User) (userResponse, error) {
	identities, err := h.queries.ListUserIdentities(ctx, u.ID)
	if err != nil {
		return userResponse{}, err
	}

	resp := userResponse{
		ID:          uuidFromPg(u.ID),
		Email:       u.Email,
		DisplayName: u.DisplayName,
		Role:        string(u.Role),
		CreatedAt:   u.CreatedAt.Time,
		AvatarURL:   AvatarURL(u),
		HasPassword: u.PasswordHash != "",
		Identities:  make([]identityResponse, 0, len(identities)),
	}
	for _, ident := range identities {
		resp.Identities = append(resp.Identities, identityResponse{
			ID:           uuidFromPg(ident.ID),
			Issuer:       ident.Issuer,
			ProviderName: h.providerName(ident.Issuer),
			Email:        ident.Email,
			CreatedAt:    ident.CreatedAt.Time,
		})
	}
	return resp, nil
}

// providerName returns the configured display name for the OIDC issuer, or
// the raw issuer for identities from a previously configured provider.
func (h *Handler) providerName(issuer string) string {
	if h.opts.OIDCIssuer != "" && SameIssuer(issuer, h.opts.OIDCIssuer) {
		return h.opts.OIDCProviderName
	}
	return issuer
}

// SameIssuer compares issuer URLs, ignoring a trailing slash.
func SameIssuer(a, b string) bool {
	return strings.TrimSuffix(a, "/") == strings.TrimSuffix(b, "/")
}

// IssueTokens creates a signed access token and a stored refresh token for u.
// Pass a transaction-bound *generated.Queries to make issuance part of a
// larger transaction.
func (h *Handler) IssueTokens(ctx context.Context, q *generated.Queries, u generated.User) (*TokenPair, error) {
	userID := uuidFromPg(u.ID)

	if h.adminRoleExpired(u, time.Now()) {
		demoted, err := q.UpdateUserRole(ctx, generated.UpdateUserRoleParams{ID: u.ID, Role: generated.UserRoleClimber})
		if err != nil {
			return nil, err
		}
		u = demoted
	}

	accessToken := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"sub":  userID.String(),
		"role": string(u.Role),
		"ver":  u.TokenVersion,
		"exp":  time.Now().Add(accessTokenDuration).Unix(),
		"iat":  time.Now().Unix(),
	})

	accessTokenStr, err := accessToken.SignedString([]byte(h.jwtSecret))
	if err != nil {
		return nil, err
	}

	// Generate random refresh token
	rawToken := make([]byte, 32)
	if _, err := rand.Read(rawToken); err != nil {
		return nil, err
	}
	refreshTokenStr := hex.EncodeToString(rawToken)

	// Store hashed refresh token
	_, err = q.CreateRefreshToken(ctx, generated.CreateRefreshTokenParams{
		UserID:    u.ID,
		TokenHash: hashToken(refreshTokenStr),
		ExpiresAt: pgTimestamptz(time.Now().Add(refreshTokenDuration)),
		// Stamped from u as read by the caller: if a revocation committed in
		// between, the token never refreshes.
		TokenVersion: u.TokenVersion,
	})
	if err != nil {
		return nil, err
	}

	return &TokenPair{
		AccessToken:  accessTokenStr,
		RefreshToken: refreshTokenStr,
	}, nil
}

// adminRoleExpired reports whether u's admin role is no longer backed by a
// recent SSO login. Only applies when the IdP manages admins.
func (h *Handler) adminRoleExpired(u generated.User, now time.Time) bool {
	if h.opts.AdminRoleMaxAge <= 0 || u.Role != generated.UserRoleAdmin {
		return false
	}
	return !u.RoleSyncedAt.Valid || now.Sub(u.RoleSyncedAt.Time) > h.opts.AdminRoleMaxAge
}

func hashToken(token string) string {
	h := sha256.Sum256([]byte(token))
	return hex.EncodeToString(h[:])
}

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}
