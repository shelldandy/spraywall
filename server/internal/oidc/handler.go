package oidc

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"strings"
	"time"

	gooidc "github.com/coreos/go-oidc/v3/oidc"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"golang.org/x/oauth2"

	"github.com/bowlinedandy/spraywall/server/db/generated"
	"github.com/bowlinedandy/spraywall/server/internal/user"
)

// Error codes passed to the SPA as ?error=<code>.
const (
	errOIDCFailed      = "oidc_failed"
	errStateInvalid    = "state_invalid"
	errEmailMissing    = "email_missing"
	errEmailUnverified = "email_unverified"
	errIdentityInUse   = "identity_in_use"
	errAccessDenied    = "access_denied"
)

const (
	idpTimeout     = 15 * time.Second
	pictureTimeout = 10 * time.Second
)

// TokenIssuer issues spraywall access/refresh tokens (user.Handler).
type TokenIssuer interface {
	IssueTokens(ctx context.Context, q *generated.Queries, u generated.User) (*user.TokenPair, error)
}

// Handler serves the OIDC login, link, and callback endpoints.
type Handler struct {
	cfg           Config
	provider      *gooidc.Provider
	verifier      *gooidc.IDTokenVerifier
	oauth         oauth2.Config
	queries       *generated.Queries
	pool          user.TxBeginner
	tokens        TokenIssuer
	storage       user.AvatarStorage
	stateKey      []byte
	secureCookie  bool
	pictureClient *http.Client
	now           func() time.Time
}

// New performs OIDC discovery against cfg.IssuerURL and returns a ready
// handler. storage may be nil to disable profile picture sync.
func New(ctx context.Context, cfg Config, queries *generated.Queries, pool user.TxBeginner, tokens TokenIssuer, storage user.AvatarStorage, jwtSecret string) (*Handler, error) {
	discoveryCtx, cancel := context.WithTimeout(ctx, idpTimeout)
	defer cancel()
	provider, err := gooidc.NewProvider(discoveryCtx, cfg.IssuerURL)
	if err != nil {
		return nil, fmt.Errorf("oidc discovery for %s: %w", cfg.IssuerURL, err)
	}

	return &Handler{
		cfg:      cfg,
		provider: provider,
		verifier: provider.Verifier(&gooidc.Config{ClientID: cfg.ClientID}),
		oauth: oauth2.Config{
			ClientID:     cfg.ClientID,
			ClientSecret: cfg.ClientSecret,
			RedirectURL:  cfg.RedirectURL,
			Endpoint:     provider.Endpoint(),
			Scopes:       cfg.Scopes,
		},
		queries:       queries,
		pool:          pool,
		tokens:        tokens,
		storage:       storage,
		stateKey:      deriveStateKey(jwtSecret),
		secureCookie:  strings.HasPrefix(strings.ToLower(cfg.RedirectURL), "https://"),
		pictureClient: newPictureClient(cfg.IssuerURL),
		now:           time.Now,
	}, nil
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v) //nolint:errcheck
}

// failureURL is where the browser lands when the flow fails.
func failureURL(mode, code string) string {
	if mode == modeLink {
		return "/profile?error=" + url.QueryEscape(code)
	}
	return "/login?error=" + url.QueryEscape(code)
}

// callbackError carries an error code for the SPA alongside the cause.
type callbackError struct {
	code string
	err  error
}

func (e *callbackError) Error() string {
	if e.err == nil {
		return e.code
	}
	return e.code + ": " + e.err.Error()
}

func (e *callbackError) Unwrap() error { return e.err }

func failWith(code string, err error) error { return &callbackError{code: code, err: err} }

func errorCode(err error) string {
	var ce *callbackError
	if errors.As(err, &ce) {
		return ce.code
	}
	return errOIDCFailed
}

// ---------- state cookie ----------

// startFlow creates fresh state, stores it in the signed cookie, and returns
// the IdP authorization URL.
func (h *Handler) startFlow(w http.ResponseWriter, mode, redirect, userID string, tokenVersion int32) (string, error) {
	state, err := randomToken()
	if err != nil {
		return "", err
	}
	nonce, err := randomToken()
	if err != nil {
		return "", err
	}
	expires := h.now().Add(stateTTL)
	st := flowState{
		State:    state,
		Nonce:    nonce,
		Verifier: oauth2.GenerateVerifier(),
		Redirect: redirect,
		Mode:     mode,
		UserID:   userID,
		Expires:  expires.Unix(),

		TokenVersion: tokenVersion,
	}
	value, err := encodeState(h.stateKey, st)
	if err != nil {
		return "", err
	}

	http.SetCookie(w, &http.Cookie{
		Name:     stateCookieName,
		Value:    value,
		Path:     "/",
		Expires:  expires,
		MaxAge:   int(stateTTL.Seconds()),
		HttpOnly: true,
		Secure:   h.secureCookie,
		SameSite: http.SameSiteLaxMode,
	})

	return h.oauth.AuthCodeURL(st.State,
		gooidc.Nonce(st.Nonce),
		oauth2.S256ChallengeOption(st.Verifier),
	), nil
}

func (h *Handler) clearStateCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name:     stateCookieName,
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   h.secureCookie,
		SameSite: http.SameSiteLaxMode,
	})
}

// ---------- endpoints ----------

// Login handles GET /auth/oidc/login?redirect=/path
func (h *Handler) Login(w http.ResponseWriter, r *http.Request) {
	redirect := sanitizeRedirect(r.URL.Query().Get("redirect"))
	authURL, err := h.startFlow(w, modeLogin, redirect, "", 0)
	if err != nil {
		log.Printf("oidc: start login: %v", err)
		http.Redirect(w, r, failureURL(modeLogin, errOIDCFailed), http.StatusFound)
		return
	}
	http.Redirect(w, r, authURL, http.StatusFound)
}

// Link handles POST /auth/oidc/link (authenticated). It returns the IdP URL
// for the SPA to navigate to, since a browser navigation cannot carry the
// bearer token.
func (h *Handler) Link(w http.ResponseWriter, r *http.Request) {
	userID := user.GetUserID(r.Context())
	if userID == uuid.Nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}
	u, err := h.queries.GetUserByID(r.Context(), pgtype.UUID{Bytes: userID, Valid: true})
	if err != nil || !user.SessionCurrent(r.Context(), u) {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "session revoked"})
		return
	}
	authURL, err := h.startFlow(w, modeLink, "/profile", userID.String(), u.TokenVersion)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"url": authURL})
}

// Callback handles GET /auth/oidc/callback
func (h *Handler) Callback(w http.ResponseWriter, r *http.Request) {
	h.clearStateCookie(w)

	cookie, err := r.Cookie(stateCookieName)
	if err != nil {
		http.Redirect(w, r, failureURL(modeLogin, errStateInvalid), http.StatusFound)
		return
	}
	st, err := decodeState(h.stateKey, cookie.Value, h.now())
	if err != nil {
		http.Redirect(w, r, failureURL(modeLogin, errStateInvalid), http.StatusFound)
		return
	}

	query := r.URL.Query()
	if idpErr := query.Get("error"); idpErr != "" {
		log.Printf("oidc: provider returned error %q: %s", idpErr, query.Get("error_description"))
		http.Redirect(w, r, failureURL(st.Mode, errAccessDenied), http.StatusFound)
		return
	}
	if subtle.ConstantTimeCompare([]byte(query.Get("state")), []byte(st.State)) != 1 {
		http.Redirect(w, r, failureURL(st.Mode, errStateInvalid), http.StatusFound)
		return
	}

	ctx := r.Context()
	id, err := h.authenticate(ctx, query.Get("code"), st)
	if err != nil {
		log.Printf("oidc: authenticate: %v", err)
		http.Redirect(w, r, failureURL(st.Mode, errOIDCFailed), http.StatusFound)
		return
	}

	if st.Mode == modeLink {
		u, err := h.linkIdentity(ctx, st.UserID, st.TokenVersion, id)
		if err != nil {
			log.Printf("oidc: link identity: %v", err)
			http.Redirect(w, r, failureURL(modeLink, errorCode(err)), http.StatusFound)
			return
		}
		h.syncPicture(ctx, u, id.claims.Picture)
		http.Redirect(w, r, "/profile?linked=1", http.StatusFound)
		return
	}

	u, tokens, err := h.loginIdentity(ctx, id)
	if err != nil {
		log.Printf("oidc: login: %v", err)
		http.Redirect(w, r, failureURL(modeLogin, errorCode(err)), http.StatusFound)
		return
	}
	h.syncPicture(ctx, u, id.claims.Picture)

	// Tokens travel in the fragment so they never reach server logs.
	fragment := "access_token=" + url.QueryEscape(tokens.AccessToken) +
		"&refresh_token=" + url.QueryEscape(tokens.RefreshToken) +
		"&redirect=" + url.QueryEscape(sanitizeRedirect(st.Redirect))
	http.Redirect(w, r, "/auth/callback#"+fragment, http.StatusFound)
}

// ---------- token exchange ----------

// verifiedIdentity is the authenticated IdP account.
type verifiedIdentity struct {
	issuer  string
	subject string
	claims  identityClaims
}

// authenticate exchanges the code (with PKCE), verifies the ID token and
// nonce, and collects claims, consulting UserInfo for any that are missing.
func (h *Handler) authenticate(ctx context.Context, code string, st flowState) (verifiedIdentity, error) {
	if code == "" {
		return verifiedIdentity{}, errors.New("missing authorization code")
	}
	ctx, cancel := context.WithTimeout(ctx, idpTimeout)
	defer cancel()

	token, err := h.oauth.Exchange(ctx, code, oauth2.VerifierOption(st.Verifier))
	if err != nil {
		return verifiedIdentity{}, fmt.Errorf("exchange code: %w", err)
	}
	rawIDToken, ok := token.Extra("id_token").(string)
	if !ok || rawIDToken == "" {
		return verifiedIdentity{}, errors.New("token response has no id_token")
	}
	idToken, err := h.verifier.Verify(ctx, rawIDToken)
	if err != nil {
		return verifiedIdentity{}, fmt.Errorf("verify id_token: %w", err)
	}
	if subtle.ConstantTimeCompare([]byte(idToken.Nonce), []byte(st.Nonce)) != 1 {
		return verifiedIdentity{}, errors.New("id_token nonce mismatch")
	}

	var raw map[string]any
	if err := idToken.Claims(&raw); err != nil {
		return verifiedIdentity{}, fmt.Errorf("decode id_token claims: %w", err)
	}
	claims := parseClaims(raw, h.cfg.GroupsClaim)

	needGroups := h.cfg.AdminGroup != "" && !claims.hasGroups
	if !claims.hasEmail || !claims.EmailVerified || needGroups || claims.Picture == "" {
		h.mergeUserInfo(ctx, token, idToken.Subject, &claims)
	}

	return verifiedIdentity{issuer: idToken.Issuer, subject: idToken.Subject, claims: claims}, nil
}

// mergeUserInfo completes claims from the UserInfo endpoint. Failures are
// logged; the caller decides whether missing claims are fatal.
func (h *Handler) mergeUserInfo(ctx context.Context, token *oauth2.Token, subject string, claims *identityClaims) {
	if h.provider.UserInfoEndpoint() == "" {
		return
	}
	info, err := h.provider.UserInfo(ctx, oauth2.StaticTokenSource(token))
	if err != nil {
		log.Printf("oidc: userinfo: %v", err)
		return
	}
	if info.Subject != subject {
		log.Printf("oidc: userinfo subject %q does not match id_token subject", info.Subject)
		return
	}
	var raw map[string]any
	if err := info.Claims(&raw); err != nil {
		log.Printf("oidc: decode userinfo claims: %v", err)
		return
	}
	claims.merge(raw, h.cfg.GroupsClaim)
}

// ---------- account resolution ----------

// loginIdentity resolves (or creates) the user for the identity, syncs the
// admin role, and issues tokens, all in one transaction.
func (h *Handler) loginIdentity(ctx context.Context, id verifiedIdentity) (generated.User, *user.TokenPair, error) {
	tx, err := h.pool.Begin(ctx)
	if err != nil {
		return generated.User{}, nil, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	q := h.queries.WithTx(tx)

	u, err := resolveUser(ctx, q, id)
	if err != nil {
		return generated.User{}, nil, err
	}

	if h.cfg.AdminGroup != "" {
		// Always write, so role_synced_at records this confirmation.
		u, err = q.SyncUserRole(ctx, generated.SyncUserRoleParams{
			ID:   u.ID,
			Role: roleForGroups(id.claims.Groups, h.cfg.AdminGroup),
		})
		if err != nil {
			return generated.User{}, nil, fmt.Errorf("sync role: %w", err)
		}
	}

	tokens, err := h.tokens.IssueTokens(ctx, q, u)
	if err != nil {
		return generated.User{}, nil, fmt.Errorf("issue tokens: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return generated.User{}, nil, err
	}
	return u, tokens, nil
}

// resolveUser finds the user for an identity: an existing link first, then
// an account with the same (IdP-verified) email, otherwise a new account.
func resolveUser(ctx context.Context, q *generated.Queries, id verifiedIdentity) (generated.User, error) {
	ident, err := q.GetIdentityByIssuerSubject(ctx, generated.GetIdentityByIssuerSubjectParams{
		Issuer:  id.issuer,
		Subject: id.subject,
	})
	if err == nil {
		if err := refreshIdentityEmail(ctx, q, ident, id.claims.Email); err != nil {
			return generated.User{}, err
		}
		return q.GetUserByID(ctx, ident.UserID)
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return generated.User{}, fmt.Errorf("look up identity: %w", err)
	}

	email := id.claims.Email
	if email == "" {
		return generated.User{}, failWith(errEmailMissing, nil)
	}
	// Accounts are keyed by email, so only an IdP-verified email may claim or
	// create one.
	if !id.claims.EmailVerified {
		return generated.User{}, failWith(errEmailUnverified, nil)
	}

	u, err := q.GetUserByEmail(ctx, email)
	switch {
	case err == nil:
		// Password registration never proves email ownership, so whoever
		// registered this address first may not be its owner. The verified
		// identity takes the account over: drop the password, any other
		// linked identities, and every session. The owner can set a new
		// password from their profile.
		if err := q.DeleteUserIdentitiesByUserID(ctx, u.ID); err != nil {
			return generated.User{}, fmt.Errorf("drop identities: %w", err)
		}
		if u.PasswordHash != "" {
			if err := q.UpdateUserPassword(ctx, generated.UpdateUserPasswordParams{ID: u.ID, PasswordHash: ""}); err != nil {
				return generated.User{}, fmt.Errorf("clear password: %w", err)
			}
			u.PasswordHash = ""
		}
		if err := q.DeleteRefreshTokensByUserID(ctx, u.ID); err != nil {
			return generated.User{}, fmt.Errorf("revoke sessions: %w", err)
		}
		if u, err = q.BumpTokenVersion(ctx, u.ID); err != nil {
			return generated.User{}, fmt.Errorf("revoke access tokens: %w", err)
		}
		log.Printf("oidc: %s (%s) claimed existing account %s by verified email; previous password, identities, and sessions revoked",
			id.subject, id.issuer, uuid.UUID(u.ID.Bytes))
	case errors.Is(err, pgx.ErrNoRows):
		u, err = q.CreateUser(ctx, generated.CreateUserParams{
			Email:        email,
			PasswordHash: "",
			DisplayName:  id.claims.displayName(),
			Role:         generated.UserRoleClimber,
		})
		if err != nil {
			return generated.User{}, fmt.Errorf("create user: %w", err)
		}
	default:
		return generated.User{}, fmt.Errorf("look up user by email: %w", err)
	}

	if _, err := q.CreateUserIdentity(ctx, generated.CreateUserIdentityParams{
		UserID:  u.ID,
		Issuer:  id.issuer,
		Subject: id.subject,
		Email:   email,
	}); err != nil {
		return generated.User{}, fmt.Errorf("create identity: %w", err)
	}
	return u, nil
}

// linkIdentity attaches the identity to the user who started the link flow.
func (h *Handler) linkIdentity(ctx context.Context, userIDStr string, tokenVersion int32, id verifiedIdentity) (generated.User, error) {
	userID, err := uuid.Parse(userIDStr)
	if err != nil {
		return generated.User{}, fmt.Errorf("invalid user id in state: %w", err)
	}

	tx, err := h.pool.Begin(ctx)
	if err != nil {
		return generated.User{}, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	q := h.queries.WithTx(tx)

	u, err := q.GetUserByIDForUpdate(ctx, pgtype.UUID{Bytes: userID, Valid: true})
	if err != nil {
		return generated.User{}, fmt.Errorf("load linking user: %w", err)
	}
	if u.TokenVersion != tokenVersion {
		return generated.User{}, failWith(errStateInvalid, nil)
	}

	ident, err := q.GetIdentityByIssuerSubject(ctx, generated.GetIdentityByIssuerSubjectParams{
		Issuer:  id.issuer,
		Subject: id.subject,
	})
	switch {
	case err == nil:
		if ident.UserID != u.ID {
			return generated.User{}, failWith(errIdentityInUse, nil)
		}
		if err := refreshIdentityEmail(ctx, q, ident, id.claims.Email); err != nil {
			return generated.User{}, err
		}
	case errors.Is(err, pgx.ErrNoRows):
		if _, err := q.CreateUserIdentity(ctx, generated.CreateUserIdentityParams{
			UserID:  u.ID,
			Issuer:  id.issuer,
			Subject: id.subject,
			Email:   id.claims.Email,
		}); err != nil {
			return generated.User{}, fmt.Errorf("create identity: %w", err)
		}
	default:
		return generated.User{}, fmt.Errorf("look up identity: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return generated.User{}, err
	}
	return u, nil
}

// refreshIdentityEmail keeps the stored IdP email current for display.
func refreshIdentityEmail(ctx context.Context, q *generated.Queries, ident generated.UserIdentity, email string) error {
	if email == "" || email == ident.Email {
		return nil
	}
	if err := q.UpdateUserIdentityEmail(ctx, generated.UpdateUserIdentityEmailParams{ID: ident.ID, Email: email}); err != nil {
		return fmt.Errorf("update identity email: %w", err)
	}
	return nil
}

// ---------- profile picture ----------

// syncPicture copies the IdP's picture into avatar storage unless the user
// uploaded their own or the picture URL is unchanged. Errors never block
// sign-in.
func (h *Handler) syncPicture(ctx context.Context, u generated.User, picture string) {
	if picture == "" || h.storage == nil {
		return
	}
	if u.AvatarSource.Valid && u.AvatarSource.String == user.AvatarSourceUpload {
		return
	}
	if u.AvatarOriginUrl.Valid && u.AvatarOriginUrl.String == picture {
		return
	}

	data, err := fetchPicture(ctx, h.pictureClient, picture)
	if err != nil {
		log.Printf("oidc: fetch picture for user %s: %v", uuid.UUID(u.ID.Bytes), err)
		return
	}
	if _, err := user.SetAvatar(ctx, h.storage, h.queries, u, data, user.AvatarSourceOIDC, picture); err != nil {
		log.Printf("oidc: store picture for user %s: %v", uuid.UUID(u.ID.Bytes), err)
	}
}

// fetchPicture downloads an image of at most user.MaxAvatarSize bytes.
func fetchPicture(ctx context.Context, client *http.Client, rawURL string) ([]byte, error) {
	parsed, err := url.Parse(rawURL)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
		return nil, fmt.Errorf("unsupported picture URL %q", rawURL)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, parsed.String(), nil)
	if err != nil {
		return nil, err
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("picture request returned %s", resp.Status)
	}

	data, err := io.ReadAll(io.LimitReader(resp.Body, user.MaxAvatarSize+1))
	if err != nil {
		return nil, err
	}
	if len(data) > user.MaxAvatarSize {
		return nil, fmt.Errorf("picture exceeds %d bytes", user.MaxAvatarSize)
	}
	if contentType, _, ok := user.SniffAvatarType(data); !ok {
		return nil, fmt.Errorf("picture is not a supported image (%s)", contentType)
	}
	return data, nil
}
