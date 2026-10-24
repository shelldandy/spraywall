package wall

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/bowlinedandy/spraywall/server/db/generated"
	"github.com/bowlinedandy/spraywall/server/internal/testdb"
	"github.com/bowlinedandy/spraywall/server/internal/user"
)

func TestIsValidWallImageMode(t *testing.T) {
	for _, mode := range []string{"", "full", "partial"} {
		if !isValidWallImageMode(mode) {
			t.Errorf("mode %q rejected", mode)
		}
	}
	if isValidWallImageMode("unknown") {
		t.Error("unknown mode accepted")
	}
}

type uploadTestStorage struct {
	deleted []string
}

func (s *uploadTestStorage) Upload(_ context.Context, _ string, reader io.Reader, _ int64, _ string) error {
	_, err := io.Copy(io.Discard, reader)
	return err
}

func (s *uploadTestStorage) Download(context.Context, string) (io.ReadCloser, string, error) {
	return io.NopCloser(strings.NewReader("")), "image/jpeg", nil
}

func (s *uploadTestStorage) Delete(_ context.Context, key string) error {
	s.deleted = append(s.deleted, key)
	return nil
}

func TestFullUploadClearsPendingPartialReset(t *testing.T) {
	pool := testdb.New(t)
	ctx := context.Background()
	queries := generated.New(pool)

	setter, err := queries.CreateUser(ctx, generated.CreateUserParams{
		Email:       uuid.NewString() + "@example.com",
		DisplayName: "Setter",
		Role:        generated.UserRoleClimber,
	})
	if err != nil {
		t.Fatal(err)
	}
	gym, err := queries.CreateGym(ctx, generated.CreateGymParams{
		Name: "Upload test gym", Slug: "upload-" + uuid.NewString()[:8], OwnerID: setter.ID,
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := queries.CreateGymMember(ctx, generated.CreateGymMemberParams{
		GymID: gym.ID, UserID: setter.ID, Role: generated.UserRoleSetter,
	}); err != nil {
		t.Fatal(err)
	}
	wall, err := queries.CreateWall(ctx, generated.CreateWallParams{GymID: gym.ID, Name: "Wall"})
	if err != nil {
		t.Fatal(err)
	}

	var activeID uuid.UUID
	if err := pool.QueryRow(ctx, `INSERT INTO wall_images(wall_id,storage_key,is_active) VALUES($1,'active.jpg',true) RETURNING id`, wall.ID).Scan(&activeID); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO wall_images(wall_id,storage_key,is_active,parent_image_id,reset_kind,review_status) VALUES($1,'pending.jpg',false,$2,'partial','pending'),($1,'older-pending.jpg',false,$2,'partial','pending')`, wall.ID, activeID); err != nil {
		t.Fatal(err)
	}

	storage := &uploadTestStorage{}
	auth := user.NewHandler(queries, "upload-test-secret", pool, user.Options{PasswordEnabled: true})
	pair, err := auth.IssueTokens(ctx, queries, setter)
	if err != nil {
		t.Fatal(err)
	}
	handler := NewHandler(queries, storage, pool)
	router := chi.NewRouter()
	router.Route("/gyms/{gymSlug}", func(r chi.Router) {
		r.Use(auth.Authenticate)
		r.Post("/walls/{wallId}/images", handler.UploadImage)
	})

	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	imagePart, err := writer.CreateFormFile("image", "new-wall.jpg")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := imagePart.Write([]byte("test image")); err != nil {
		t.Fatal(err)
	}
	if err := writer.WriteField("mode", "full"); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}

	wallID := uuid.UUID(wall.ID.Bytes)
	request := httptest.NewRequest(http.MethodPost, fmt.Sprintf("/gyms/%s/walls/%s/images", gym.Slug, wallID), &body)
	request.Header.Set("Authorization", "Bearer "+pair.AccessToken)
	request.Header.Set("Content-Type", writer.FormDataContentType())
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusCreated {
		t.Fatalf("upload status=%d body=%s", response.Code, response.Body)
	}

	var pendingCount, activeCount int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM wall_images WHERE wall_id=$1 AND reset_kind='partial' AND review_status='pending'`, wall.ID).Scan(&pendingCount); err != nil {
		t.Fatal(err)
	}
	if pendingCount != 0 {
		t.Fatalf("pending reset remains after full upload: %d", pendingCount)
	}
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM wall_images WHERE wall_id=$1 AND is_active=true AND reset_kind='full'`, wall.ID).Scan(&activeCount); err != nil {
		t.Fatal(err)
	}
	if activeCount != 1 {
		t.Fatalf("active full images=%d; want 1", activeCount)
	}
	deleted := map[string]bool{}
	for _, key := range storage.deleted {
		deleted[key] = true
	}
	if len(deleted) != 2 || !deleted["pending.jpg"] || !deleted["older-pending.jpg"] {
		t.Fatalf("deleted storage objects=%v; want both pending reset images", storage.deleted)
	}
}
