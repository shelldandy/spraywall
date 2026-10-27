package route

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/bowlinedandy/spraywall/server/db/generated"
	"github.com/bowlinedandy/spraywall/server/internal/shared"
	"github.com/bowlinedandy/spraywall/server/internal/user"
)

var (
	youtubeIDPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{11}$`)
	shortcodePattern = regexp.MustCompile(`^[A-Za-z0-9_-]{1,128}$`)
	tiktokIDPattern  = regexp.MustCompile(`^[A-Za-z0-9_-]{1,128}$`)
)

const immichHostNotAllowedMessage = "Immich host isn't allowed on this server"

var errImmichHostNotAllowed = errors.New("immich host isn't allowed on this server")

type immichRef struct {
	baseURL   string
	shareKey  string
	shareSlug string
}

// parseBetaVideoURL validates and canonicalizes a supported video link. Passing
// allowedHosts applies the Immich SSRF allow-list; without it, Immich links are
// parsed but should not be used to make network requests.
func parseBetaVideoURL(raw string, allowedHosts ...string) (source string, externalID *string, normalized string, ref *immichRef, err error) {
	clean := strings.TrimSpace(raw)
	if clean == "" || len(clean) > 2048 {
		return "", nil, "", nil, errors.New("enter a valid video link")
	}
	parsed, parseErr := url.Parse(clean)
	if parseErr != nil || parsed.Host == "" || parsed.User != nil || parsed.Fragment != "" || (parsed.Scheme != "https" && parsed.Scheme != "http") {
		return "", nil, "", nil, errors.New("enter a valid video link")
	}
	host := normalizeHost(parsed.Host)
	hostname := strings.ToLower(strings.TrimSuffix(parsed.Hostname(), "."))
	path := strings.Trim(parsed.EscapedPath(), "/")
	segments := strings.Split(path, "/")
	var id string

	if isImmichPath(segments) {
		if len(allowedHosts) > 0 && !allowedImmichHost(host, allowedHosts) {
			return "", nil, "", nil, errImmichHostNotAllowed
		}
		if len(segments) != 2 || segments[1] == "" || !shortcodePattern.MatchString(segments[1]) {
			return "", nil, "", nil, errors.New("invalid Immich share link")
		}
		base := strings.ToLower(parsed.Scheme) + "://" + parsed.Host
		ref = &immichRef{baseURL: base}
		if segments[0] == "share" {
			ref.shareKey = segments[1]
		} else {
			ref.shareSlug = segments[1]
		}
		return "immich", nil, base + "/" + segments[0] + "/" + segments[1], ref, nil
	}

	if isYouTubeHost(hostname) && parsed.Port() == "" {
		switch {
		case hostname == "youtu.be":
			if len(segments) > 0 {
				id = segments[0]
			}
		case len(segments) == 2 && segments[0] == "shorts":
			id = segments[1]
		case (parsed.Path == "/watch" || parsed.Path == "/watch/"):
			id = parsed.Query().Get("v")
		}
		if !youtubeIDPattern.MatchString(id) {
			return "", nil, "", nil, errors.New("invalid YouTube video link")
		}
		return betaVideoResult("youtube", id, "https://www.youtube.com/watch?v="+id)
	}

	if isInstagramHost(hostname) && parsed.Port() == "" && len(segments) == 2 && (segments[0] == "reel" || segments[0] == "p") {
		id = segments[1]
		if !shortcodePattern.MatchString(id) {
			return "", nil, "", nil, errors.New("invalid Instagram video link")
		}
		return betaVideoResult("instagram", id, "https://www.instagram.com/"+segments[0]+"/"+id+"/")
	}

	if isTikTokHost(hostname) && parsed.Port() == "" {
		shortLink := hostname == "vm.tiktok.com" || hostname == "vt.tiktok.com"
		if shortLink {
			if len(segments) > 0 {
				id = segments[0]
			}
		} else {
			for i := 0; i+1 < len(segments); i++ {
				if segments[i] == "video" {
					id = segments[i+1]
					break
				}
			}
			if id == "" && len(segments) == 2 && segments[0] == "t" {
				id = segments[1]
			}
		}
		if !tiktokIDPattern.MatchString(id) {
			return "", nil, "", nil, errors.New("invalid TikTok video link")
		}
		canonicalHost := "www.tiktok.com"
		if shortLink {
			canonicalHost = hostname
		}
		canonical := "https://" + canonicalHost + "/" + strings.Join(segments, "/")
		return betaVideoResult("tiktok", id, canonical)
	}

	return "", nil, "", nil, errors.New("unsupported video link")
}

func betaVideoResult(source, id, normalized string) (string, *string, string, *immichRef, error) {
	return source, &id, normalized, nil, nil
}

func isImmichPath(segments []string) bool {
	return len(segments) > 0 && (segments[0] == "share" || segments[0] == "s")
}

func allowedImmichHost(host string, allowedHosts []string) bool {
	for _, allowed := range allowedHosts {
		if normalizeHost(strings.TrimSpace(allowed)) == normalizeHost(host) {
			return true
		}
	}
	return false
}

func isYouTubeHost(host string) bool {
	return host == "youtube.com" || host == "www.youtube.com" || host == "m.youtube.com" || host == "youtu.be"
}

func isInstagramHost(host string) bool {
	return host == "instagram.com" || host == "www.instagram.com" || host == "m.instagram.com"
}

func isTikTokHost(host string) bool {
	return host == "tiktok.com" || host == "www.tiktok.com" || host == "m.tiktok.com" || host == "vm.tiktok.com" || host == "vt.tiktok.com"
}

type betaVideoUser struct {
	ID          string  `json:"id"`
	DisplayName string  `json:"display_name"`
	AvatarURL   *string `json:"avatar_url"`
}

type BetaVideo struct {
	ID            string        `json:"id"`
	Source        string        `json:"source"`
	URL           string        `json:"url"`
	ClimberHandle *string       `json:"climber_handle"`
	ThumbnailURL  *string       `json:"thumbnail_url"`
	PlaybackURL   *string       `json:"playback_url"`
	CreatedAt     time.Time     `json:"created_at"`
	User          betaVideoUser `json:"user"`
	CanDelete     bool          `json:"can_delete"`
}

type BetaVideoList struct {
	Items []BetaVideo `json:"items"`
	Total int         `json:"total"`
}

type betaVideoPermission struct {
	userID uuid.UUID
	role   generated.UserRole
}

func betaVideoCanDelete(owner string, permission betaVideoPermission) bool {
	return owner == permission.userID.String() || permission.role == generated.UserRoleSetter || permission.role == generated.UserRoleAdmin
}

// RouteBetaVideos handles GET /gyms/{gymSlug}/walls/{wallId}/routes/{routeId}/beta-videos.
func (h *Handler) RouteBetaVideos(w http.ResponseWriter, r *http.Request) {
	scope, ok := h.scopedRoute(w, r)
	if !ok {
		return
	}
	_, member, err := h.requireGymMember(w, r)
	if err != nil {
		return
	}
	viewer := betaVideoPermission{userID: user.GetUserID(r.Context()), role: member.Role}
	rows, err := h.db.Query(r.Context(), `
SELECT v.id::text, v.source, v.url, v.external_id, v.climber_handle, v.created_at,
       v.immich_base_url, v.immich_share_key, v.immich_share_slug, v.immich_asset_id,
       u.id::text, u.display_name, u.avatar_key
FROM beta_videos v
JOIN users u ON u.id = v.user_id
WHERE v.route_id = $1
ORDER BY v.created_at DESC, v.id DESC
LIMIT 100`, scope.route.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not fetch beta videos")
		return
	}
	defer rows.Close()
	items := make([]BetaVideo, 0)
	for rows.Next() {
		item, scanErr := scanBetaVideo(rows, viewer)
		if scanErr != nil {
			writeError(w, http.StatusInternalServerError, "database error")
			return
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		writeError(w, http.StatusInternalServerError, "database error")
		return
	}
	rows.Close()
	var total int
	if err := h.db.QueryRow(r.Context(), `SELECT count(*) FROM beta_videos WHERE route_id=$1`, scope.route.ID).Scan(&total); err != nil {
		writeError(w, http.StatusInternalServerError, "could not count beta videos")
		return
	}
	writeJSON(w, http.StatusOK, BetaVideoList{Items: items, Total: total})
}

type betaVideoRow interface {
	Scan(dest ...any) error
}

func scanBetaVideo(row betaVideoRow, permission betaVideoPermission) (BetaVideo, error) {
	var item BetaVideo
	var externalID, handle, baseURL, shareKey, shareSlug, assetID, avatarKey pgtype.Text
	if err := row.Scan(&item.ID, &item.Source, &item.URL, &externalID, &handle, &item.CreatedAt,
		&baseURL, &shareKey, &shareSlug, &assetID,
		&item.User.ID, &item.User.DisplayName, &avatarKey); err != nil {
		return item, err
	}
	if handle.Valid {
		item.ClimberHandle = &handle.String
	}
	item.User.AvatarURL = user.AvatarURL(generated.User{AvatarKey: avatarKey})
	item.CanDelete = betaVideoCanDelete(item.User.ID, permission)
	if item.Source == "youtube" && externalID.Valid {
		item.ThumbnailURL = stringPointer("https://img.youtube.com/vi/" + externalID.String + "/hqdefault.jpg")
	}
	if item.Source == "immich" {
		item.ThumbnailURL = stringPointer("/beta-media/" + item.ID + "/thumbnail")
		item.PlaybackURL = stringPointer("/beta-media/" + item.ID + "/playback")
	}
	return item, nil
}

// CreateBetaVideo handles POST /gyms/{gymSlug}/walls/{wallId}/routes/{routeId}/beta-videos.
func (h *Handler) CreateBetaVideo(w http.ResponseWriter, r *http.Request) {
	scope, ok := h.scopedRoute(w, r)
	if !ok {
		return
	}
	_, _, err := h.requireGymMember(w, r)
	if err != nil {
		return
	}
	var body struct {
		URL           string  `json:"url"`
		ClimberHandle *string `json:"climber_handle"`
	}
	r.Body = http.MaxBytesReader(w, r.Body, 8<<10)
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if body.ClimberHandle != nil {
		handle := strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(*body.ClimberHandle), "@"))
		if len(handle) > 80 {
			writeError(w, http.StatusBadRequest, "climber handle must be 80 characters or fewer")
			return
		}
		if handle == "" {
			body.ClimberHandle = nil
		} else {
			body.ClimberHandle = &handle
		}
	}
	if isImmichURL(body.URL) && !h.immich.hasAllowedHosts() {
		writeError(w, http.StatusUnprocessableEntity, immichDisabledMessage)
		return
	}
	parsedHosts := h.immich.allowedHostList()
	source, externalID, normalized, ref, err := parseBetaVideoURL(body.URL, parsedHosts...)
	if err != nil {
		if errors.Is(err, errImmichHostNotAllowed) {
			writeError(w, http.StatusUnprocessableEntity, immichHostNotAllowedMessage)
		} else {
			writeError(w, http.StatusBadRequest, err.Error())
		}
		return
	}
	var assetID any
	var baseURL, shareKey, shareSlug any
	if source == "immich" {
		resolved, resolvedShareKey, resolveErr := h.immich.resolveVideo(r.Context(), ref)
		if resolveErr != nil {
			status := http.StatusUnprocessableEntity
			message := resolveErr.Error()
			switch {
			case errors.Is(resolveErr, errImmichUpstream):
				status = http.StatusBadGateway
			case errors.Is(resolveErr, errImmichHostNotAllowed):
				message = immichHostNotAllowedMessage
			case errors.Is(resolveErr, errImmichPasswordProtected):
				message = immichPasswordProtectedMessage
			}
			writeError(w, status, message)
			return
		}
		assetID, baseURL = resolved, ref.baseURL
		if resolvedShareKey != "" {
			shareKey = resolvedShareKey
		} else if ref.shareKey != "" {
			shareKey = ref.shareKey
		}
		if ref.shareSlug != "" {
			shareSlug = ref.shareSlug
		}
	}
	var external any
	if externalID != nil {
		external = *externalID
	}
	var handle any
	if body.ClimberHandle != nil {
		handle = *body.ClimberHandle
	}
	var id string
	err = h.db.QueryRow(r.Context(), `
INSERT INTO beta_videos (route_id, user_id, source, url, external_id, climber_handle,
                        immich_base_url, immich_share_key, immich_share_slug, immich_asset_id)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
RETURNING id::text`, scope.route.ID, shared.PgUUID(user.GetUserID(r.Context())), source, normalized, external, handle, baseURL, shareKey, shareSlug, assetID).Scan(&id)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			writeError(w, http.StatusConflict, "this video has already been added")
		} else {
			writeError(w, http.StatusInternalServerError, "could not create beta video")
		}
		return
	}
	item, err := h.getBetaVideo(r, id, betaVideoPermission{userID: user.GetUserID(r.Context())})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not fetch created beta video")
		return
	}
	writeJSON(w, http.StatusCreated, item)
}

func isImmichURL(raw string) bool {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		return false
	}
	segments := strings.Split(strings.Trim(parsed.EscapedPath(), "/"), "/")
	return isImmichPath(segments)
}

func (h *Handler) getBetaVideo(r *http.Request, id string, permission betaVideoPermission) (BetaVideo, error) {
	row := h.db.QueryRow(r.Context(), `
SELECT v.id::text, v.source, v.url, v.external_id, v.climber_handle, v.created_at,
       v.immich_base_url, v.immich_share_key, v.immich_share_slug, v.immich_asset_id,
       u.id::text, u.display_name, u.avatar_key
FROM beta_videos v JOIN users u ON u.id=v.user_id WHERE v.id=$1`, id)
	return scanBetaVideo(row, permission)
}

// DeleteBetaVideo handles DELETE /gyms/{gymSlug}/walls/{wallId}/routes/{routeId}/beta-videos/{videoId}.
func (h *Handler) DeleteBetaVideo(w http.ResponseWriter, r *http.Request) {
	scope, ok := h.scopedRoute(w, r)
	if !ok {
		return
	}
	_, member, err := h.requireGymMember(w, r)
	if err != nil {
		return
	}
	videoID, err := uuid.Parse(chi.URLParam(r, "videoId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid video id")
		return
	}
	var posterID string
	err = h.db.QueryRow(r.Context(), `SELECT user_id::text FROM beta_videos WHERE id=$1 AND route_id=$2`, shared.PgUUID(videoID), scope.route.ID).Scan(&posterID)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "beta video not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "database error")
		return
	}
	permission := betaVideoPermission{userID: user.GetUserID(r.Context()), role: member.Role}
	if !betaVideoCanDelete(posterID, permission) {
		writeError(w, http.StatusForbidden, "only the poster, setters, or admins can delete beta videos")
		return
	}
	if _, err := h.db.Exec(r.Context(), `DELETE FROM beta_videos WHERE id=$1 AND route_id=$2`, shared.PgUUID(videoID), scope.route.ID); err != nil {
		writeError(w, http.StatusInternalServerError, "could not delete beta video")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ServeBetaMedia is intentionally public so native img/video elements can load
// Immich media without an Authorization header. UUIDs are unguessable and only
// media for a currently existing share row is returned.
func (h *Handler) ServeBetaMedia(w http.ResponseWriter, r *http.Request) {
	videoID, err := uuid.Parse(chi.URLParam(r, "videoId"))
	if err != nil {
		http.NotFound(w, r)
		return
	}
	kind := chi.URLParam(r, "kind")
	if kind != "thumbnail" && kind != "playback" {
		http.NotFound(w, r)
		return
	}
	var baseURL, shareKey, shareSlug, assetID pgtype.Text
	err = h.db.QueryRow(r.Context(), `SELECT immich_base_url, immich_share_key, immich_share_slug, immich_asset_id
FROM beta_videos WHERE id=$1 AND source='immich'`, shared.PgUUID(videoID)).Scan(&baseURL, &shareKey, &shareSlug, &assetID)
	if errors.Is(err, pgx.ErrNoRows) {
		http.NotFound(w, r)
		return
	}
	if err != nil || !baseURL.Valid || !assetID.Valid || h.immich == nil {
		http.Error(w, "media unavailable", http.StatusBadGateway)
		return
	}
	path := "/api/assets/" + url.PathEscape(assetID.String)
	if kind == "thumbnail" {
		path += "/thumbnail"
	} else {
		path += "/video/playback"
	}
	if kind == "thumbnail" {
		path += "?size=preview"
	}
	var key, slug string
	if shareKey.Valid {
		key = shareKey.String
	}
	if shareSlug.Valid {
		slug = shareSlug.String
	}
	upstream, err := h.immich.mediaRequest(r.Context(), baseURL.String, path, key, slug, r.Header)
	if err != nil {
		http.Error(w, "Immich media unavailable", http.StatusBadGateway)
		return
	}
	defer func() { _ = upstream.Body.Close() }()
	if upstream.StatusCode == http.StatusNotFound || upstream.StatusCode == http.StatusGone || upstream.StatusCode == http.StatusUnauthorized || upstream.StatusCode == http.StatusForbidden {
		http.NotFound(w, r)
		return
	}
	if upstream.StatusCode != http.StatusOK && upstream.StatusCode != http.StatusPartialContent {
		http.Error(w, "Immich media unavailable", http.StatusBadGateway)
		return
	}
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Content-Security-Policy", "sandbox")
	if kind == "thumbnail" {
		w.Header().Set("Cache-Control", "public, max-age=86400")
	}
	for _, name := range []string{"Content-Type", "Content-Length", "Content-Range", "Accept-Ranges", "ETag"} {
		if value := upstream.Header.Get(name); value != "" {
			w.Header().Set(name, value)
		}
	}
	w.WriteHeader(upstream.StatusCode)
	if _, err := io.Copy(w, upstream.Body); err != nil {
		// The client may have disconnected during the streamed response.
		return
	}
}
