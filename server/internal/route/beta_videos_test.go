package route_test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/bowlinedandy/spraywall/server/db/generated"
	routehandler "github.com/bowlinedandy/spraywall/server/internal/route"
	"github.com/bowlinedandy/spraywall/server/internal/shared"
	"github.com/bowlinedandy/spraywall/server/internal/user"
)

type betaVideoResponse struct {
	ID            string  `json:"id"`
	Source        string  `json:"source"`
	URL           string  `json:"url"`
	ClimberHandle *string `json:"climber_handle"`
	ThumbnailURL  *string `json:"thumbnail_url"`
	PlaybackURL   *string `json:"playback_url"`
	CanDelete     bool    `json:"can_delete"`
	User          struct {
		ID          string  `json:"id"`
		DisplayName string  `json:"display_name"`
		AvatarURL   *string `json:"avatar_url"`
	} `json:"user"`
}

type betaVideoPageResponse struct {
	Items []betaVideoResponse `json:"items"`
	Total int                 `json:"total"`
}

func betaMember(t *testing.T, e *routeTestEnv, name string, role generated.UserRole) string {
	t.Helper()
	created, err := e.q.CreateUser(t.Context(), generated.CreateUserParams{
		Email: name + "@beta-test.example", DisplayName: name, Role: generated.UserRoleClimber,
	})
	if err != nil {
		t.Fatal(err)
	}
	gymID := shared.PgUUID(uuid.Nil)
	if err := e.pool.QueryRow(t.Context(), `SELECT gym_id FROM walls WHERE id=$1`, shared.PgUUID(e.wallID)).Scan(&gymID); err != nil {
		t.Fatal(err)
	}
	if err := e.q.CreateGymMember(t.Context(), generated.CreateGymMemberParams{GymID: gymID, UserID: created.ID, Role: role}); err != nil {
		t.Fatal(err)
	}
	auth := user.NewHandler(e.q, routeTestJWTSecret, e.pool, user.Options{})
	tokens, err := auth.IssueTokens(t.Context(), e.q, created)
	if err != nil {
		t.Fatal(err)
	}
	return tokens.AccessToken
}

func decodeBetaVideoPage(t *testing.T, rec *httptest.ResponseRecorder) betaVideoPageResponse {
	t.Helper()
	var page betaVideoPageResponse
	if rec.Code != http.StatusOK {
		t.Fatalf("list beta videos: %d %s", rec.Code, rec.Body)
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &page); err != nil {
		t.Fatalf("decode beta video page: %v: %s", err, rec.Body)
	}
	return page
}

func createBetaVideo(t *testing.T, e *routeTestEnv, routeID, token, url string) betaVideoResponse {
	t.Helper()
	body, _ := json.Marshal(map[string]any{"url": url, "climber_handle": "@beta-climber"})
	rec := e.requestSubpath(http.MethodPost, routeID, "/beta-videos", token, string(body))
	if rec.Code != http.StatusCreated {
		t.Fatalf("create beta video: %d %s", rec.Code, rec.Body)
	}
	var video betaVideoResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &video); err != nil {
		t.Fatalf("decode beta video: %v: %s", err, rec.Body)
	}
	return video
}

func TestBetaVideoCreateListDuplicateAndDeletePermissions(t *testing.T) {
	e := newRouteTestEnv(t)
	routeA := e.create(t, "", "published")
	routeB := e.create(t, "", "published")
	readerToken := betaMember(t, e, "beta-reader", generated.UserRoleClimber)
	setterToken := betaMember(t, e, "beta-setter", generated.UserRoleSetter)

	first := createBetaVideo(t, e, routeA.ID, e.other, "https://youtu.be/dQw4w9WgXcQ")
	if first.Source != "youtube" || first.URL != "https://www.youtube.com/watch?v=dQw4w9WgXcQ" || first.ThumbnailURL == nil || *first.ThumbnailURL != "https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg" || first.PlaybackURL != nil {
		t.Fatalf("unexpected created YouTube video: %#v", first)
	}
	if first.ClimberHandle == nil || *first.ClimberHandle != "beta-climber" || !first.CanDelete {
		t.Fatalf("handle normalization or poster permission failed: %#v", first)
	}
	if rec := e.requestSubpath(http.MethodPost, routeA.ID, "/beta-videos", e.other, `{"url":"https://www.youtube.com/shorts/dQw4w9WgXcQ"}`); rec.Code != http.StatusConflict {
		t.Fatalf("duplicate status = %d, want 409: %s", rec.Code, rec.Body)
	}

	second := createBetaVideo(t, e, routeA.ID, e.other, "https://www.instagram.com/reel/CxYz_123/")
	third := createBetaVideo(t, e, routeA.ID, e.other, "https://www.tiktok.com/@climber/video/1234567890123456789")
	page := decodeBetaVideoPage(t, e.requestSubpath(http.MethodGet, routeA.ID, "/beta-videos", readerToken, ""))
	if page.Total != 3 || len(page.Items) != 3 || page.Items[0].ID != third.ID || page.Items[2].ID != first.ID {
		t.Fatalf("videos should be newest-first with total 3: %#v", page)
	}
	if page.Items[0].ThumbnailURL != nil || page.Items[0].PlaybackURL != nil {
		t.Fatalf("TikTok should not use a fetched thumbnail or playback: %#v", page.Items[0])
	}
	for _, tokenCase := range []struct {
		name  string
		token string
		want  bool
	}{{"poster", e.other, true}, {"other member", readerToken, false}, {"setter", setterToken, true}, {"admin", e.token, true}} {
		t.Run("can_delete/"+tokenCase.name, func(t *testing.T) {
			got := decodeBetaVideoPage(t, e.requestSubpath(http.MethodGet, routeA.ID, "/beta-videos", tokenCase.token, ""))
			if got.Items[0].CanDelete != tokenCase.want {
				t.Fatalf("can_delete=%v, want %v", got.Items[0].CanDelete, tokenCase.want)
			}
		})
	}
	if rec := e.requestSubpath(http.MethodDelete, routeA.ID, "/beta-videos/"+first.ID, readerToken, ""); rec.Code != http.StatusForbidden {
		t.Fatalf("other member delete status=%d, want 403: %s", rec.Code, rec.Body)
	}
	if rec := e.requestSubpath(http.MethodDelete, routeB.ID, "/beta-videos/"+first.ID, e.token, ""); rec.Code != http.StatusNotFound {
		t.Fatalf("cross-route delete status=%d, want 404: %s", rec.Code, rec.Body)
	}
	if rec := e.requestSubpath(http.MethodDelete, routeA.ID, "/beta-videos/"+first.ID, e.other, ""); rec.Code != http.StatusNoContent {
		t.Fatalf("poster delete status=%d: %s", rec.Code, rec.Body)
	}
	if rec := e.requestSubpath(http.MethodDelete, routeA.ID, "/beta-videos/"+second.ID, setterToken, ""); rec.Code != http.StatusNoContent {
		t.Fatalf("setter delete status=%d: %s", rec.Code, rec.Body)
	}
	if rec := e.requestSubpath(http.MethodDelete, routeA.ID, "/beta-videos/"+third.ID, e.token, ""); rec.Code != http.StatusNoContent {
		t.Fatalf("admin delete status=%d: %s", rec.Code, rec.Body)
	}
}

func TestBetaVideoRejectsImmichWhenDisabledOrHostIsNotAllowed(t *testing.T) {
	e := newRouteTestEnv(t)
	rt := e.create(t, "", "published")
	if rec := e.requestSubpath(http.MethodPost, rt.ID, "/beta-videos", e.token, `{"url":"https://photos.example.net/share/key"}`); rec.Code != http.StatusUnprocessableEntity || !strings.Contains(rec.Body.String(), "Immich links aren't enabled") {
		t.Fatalf("disabled Immich response = %d %s", rec.Code, rec.Body)
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"assets":[{"id":"video","type":"VIDEO"}]}`))
	}))
	defer server.Close()
	e.handler.SetImmichClient(routehandler.NewImmichClient([]string{"allowed.example.net"}))
	if rec := e.requestSubpath(http.MethodPost, rt.ID, "/beta-videos", e.token, `{"url":"`+server.URL+`/share/key"}`); rec.Code != http.StatusUnprocessableEntity || !strings.Contains(rec.Body.String(), "isn't allowed") {
		t.Fatalf("disallowed Immich response = %d %s", rec.Code, rec.Body)
	}
}

func TestImmichShareResolutionPasswordProtectionAndRangeProxy(t *testing.T) {
	e := newRouteTestEnv(t)
	rt := e.create(t, "", "published")
	var sawRange string
	var sawVideoAsset bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/shared-links/me":
			if r.URL.Query().Get("key") == "locked" {
				http.Error(w, "password required", http.StatusUnauthorized)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"assets":[{"id":"image-asset","type":"IMAGE"},{"id":"video-asset","type":"VIDEO"}]}`))
		case "/api/assets/video-asset/video/playback":
			sawVideoAsset = r.URL.Query().Get("key") == "share-key"
			sawRange = r.Header.Get("Range")
			w.Header().Set("Content-Type", "video/mp4")
			w.Header().Set("Content-Length", "3")
			w.Header().Set("Content-Range", "bytes 2-4/10")
			w.Header().Set("Accept-Ranges", "bytes")
			w.Header().Set("ETag", `"clip-tag"`)
			w.WriteHeader(http.StatusPartialContent)
			_, _ = w.Write([]byte("234"))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	e.handler.SetImmichClient(routehandler.NewImmichClient([]string{strings.TrimPrefix(server.URL, "http://")}))

	video := createBetaVideo(t, e, rt.ID, e.other, server.URL+"/share/share-key")
	if video.Source != "immich" || video.ThumbnailURL == nil || video.PlaybackURL == nil || !strings.Contains(*video.PlaybackURL, "/beta-media/") {
		t.Fatalf("Immich video response is missing media paths: %#v", video)
	}
	if rec := e.requestSubpath(http.MethodPost, rt.ID, "/beta-videos", e.other, `{"url":"`+server.URL+`/share/locked"}`); rec.Code != http.StatusUnprocessableEntity || !strings.Contains(rec.Body.String(), "password-protected") {
		t.Fatalf("password-protected share status=%d body=%s", rec.Code, rec.Body)
	}

	request := httptest.NewRequest(http.MethodGet, *video.PlaybackURL, nil)
	request.Header.Set("Range", "bytes=2-4")
	response := httptest.NewRecorder()
	e.router.ServeHTTP(response, request)
	if response.Code != http.StatusPartialContent || response.Header().Get("Content-Range") != "bytes 2-4/10" || response.Header().Get("Content-Type") != "video/mp4" || response.Body.String() != "234" {
		t.Fatalf("range proxy response=%d headers=%v body=%q", response.Code, response.Header(), response.Body.String())
	}
	if sawRange != "bytes=2-4" || !sawVideoAsset {
		t.Fatalf("upstream did not receive range/share video request: range=%q asset=%v", sawRange, sawVideoAsset)
	}
	if response.Header().Get("X-Content-Type-Options") != "nosniff" || response.Header().Get("Content-Security-Policy") != "sandbox" {
		t.Fatalf("security headers missing: %v", response.Header())
	}
}

func TestImmichResolveCanUseAlbumAssets(t *testing.T) {
	e := newRouteTestEnv(t)
	rt := e.create(t, "", "published")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("slug") != "album-slug" {
			t.Errorf("share slug query = %q", r.URL.Query().Get("slug"))
		}
		_, _ = fmt.Fprint(w, `{"key":"resolved-key","album":{"assets":[{"id":"album-video","type":"VIDEO"}]}}`)
	}))
	defer server.Close()
	e.handler.SetImmichClient(routehandler.NewImmichClient([]string{strings.TrimPrefix(server.URL, "http://")}))
	rec := e.requestSubpath(http.MethodPost, rt.ID, "/beta-videos", e.token, `{"url":"`+server.URL+`/s/album-slug"}`)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create slug share: %d %s", rec.Code, rec.Body)
	}
	var assetID string
	if err := e.pool.QueryRow(t.Context(), `SELECT immich_asset_id FROM beta_videos WHERE url=$1`, server.URL+"/s/album-slug").Scan(&assetID); err != nil {
		t.Fatal(err)
	}
	if assetID != "album-video" {
		t.Fatalf("resolved album asset id=%q, want album-video", assetID)
	}
	var resolvedKey, savedSlug string
	if err := e.pool.QueryRow(t.Context(), `SELECT immich_share_key, immich_share_slug FROM beta_videos WHERE immich_asset_id=$1`, assetID).Scan(&resolvedKey, &savedSlug); err != nil {
		t.Fatal(err)
	}
	if resolvedKey != "resolved-key" || savedSlug != "album-slug" {
		t.Fatalf("saved share ref key=%q slug=%q", resolvedKey, savedSlug)
	}
}
