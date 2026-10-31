package wall

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/bowlinedandy/spraywall/server/db/generated"
	"github.com/bowlinedandy/spraywall/server/internal/testdb"
	"github.com/bowlinedandy/spraywall/server/internal/user"
	"github.com/jackc/pgx/v5/pgxpool"
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
	mu        sync.Mutex
	uploaded  []string
	deleted   []string
	deleteErr error
	uploadFn  func(context.Context, string) error
}

func (s *uploadTestStorage) Upload(ctx context.Context, key string, reader io.Reader, _ int64, _ string) error {
	if _, err := io.Copy(io.Discard, reader); err != nil {
		return err
	}
	s.mu.Lock()
	s.uploaded = append(s.uploaded, key)
	uploadFn := s.uploadFn
	s.mu.Unlock()
	if uploadFn != nil {
		return uploadFn(ctx, key)
	}
	return nil
}

func (s *uploadTestStorage) Download(context.Context, string) (io.ReadCloser, string, error) {
	return io.NopCloser(strings.NewReader("")), "image/jpeg", nil
}

func (s *uploadTestStorage) Delete(_ context.Context, key string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.deleted = append(s.deleted, key)
	return s.deleteErr
}

type uploadTestEnv struct {
	pool     *pgxpool.Pool
	queries  *generated.Queries
	storage  *uploadTestStorage
	handler  *Handler
	gymSlug  string
	wallID   uuid.UUID
	activeID uuid.UUID
	token    string
	router   chi.Router
}

func newUploadTestEnv(t *testing.T, storage *uploadTestStorage) *uploadTestEnv {
	t.Helper()
	ctx := context.Background()
	pool := testdb.New(t)
	queries := generated.New(pool)
	setter, err := queries.CreateUser(ctx, generated.CreateUserParams{
		Email: uuid.NewString() + "@example.com", DisplayName: "Setter", Role: generated.UserRoleClimber,
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
	wallRow, err := queries.CreateWall(ctx, generated.CreateWallParams{GymID: gym.ID, Name: "Wall"})
	if err != nil {
		t.Fatal(err)
	}
	active, err := queries.CreateWallImage(ctx, generated.CreateWallImageParams{WallID: wallRow.ID, StorageKey: "active.jpg"})
	if err != nil {
		t.Fatal(err)
	}
	auth := user.NewHandler(queries, "upload-test-secret", pool, user.Options{PasswordEnabled: true})
	pair, err := auth.IssueTokens(ctx, queries, setter)
	if err != nil {
		t.Fatal(err)
	}
	handler := NewHandler(queries, storage, pool)
	router := chi.NewRouter()
	router.Get("/images/*", handler.ServeImage)
	router.Route("/gyms/{gymSlug}", func(r chi.Router) {
		r.Use(auth.Authenticate)
		r.Delete("/", handler.DeleteGym)
		r.Delete("/walls/{wallId}", handler.DeleteWall)
		r.Post("/walls/{wallId}/images", handler.UploadImage)
		r.Post("/walls/{wallId}/resets/{imageId}/apply", handler.ApplyReset)
	})
	return &uploadTestEnv{
		pool: pool, queries: queries, storage: storage, handler: handler, gymSlug: gym.Slug,
		wallID: uuid.UUID(wallRow.ID.Bytes), activeID: uuid.UUID(active.ID.Bytes),
		token: pair.AccessToken, router: router,
	}
}

func (e *uploadTestEnv) upload(mode string) *httptest.ResponseRecorder {
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	image, err := writer.CreateFormFile("image", "upload.jpg")
	if err != nil {
		panic(err)
	}
	_, _ = image.Write([]byte("test image"))
	_ = writer.WriteField("mode", mode)
	_ = writer.Close()

	path := fmt.Sprintf("/gyms/%s/walls/%s/images", e.gymSlug, e.wallID)
	request := httptest.NewRequest(http.MethodPost, path, &body)
	request.Header.Set("Authorization", "Bearer "+e.token)
	request.Header.Set("Content-Type", writer.FormDataContentType())
	response := httptest.NewRecorder()
	e.router.ServeHTTP(response, request)
	return response
}

func (e *uploadTestEnv) applyReset(imageID uuid.UUID) *httptest.ResponseRecorder {
	path := fmt.Sprintf("/gyms/%s/walls/%s/resets/%s/apply", e.gymSlug, e.wallID, imageID)
	request := httptest.NewRequest(http.MethodPost, path, nil)
	request.Header.Set("Authorization", "Bearer "+e.token)
	response := httptest.NewRecorder()
	e.router.ServeHTTP(response, request)
	return response
}

func (e *uploadTestEnv) createCompletedPendingReset(t *testing.T) uuid.UUID {
	t.Helper()
	var pendingID uuid.UUID
	if err := e.pool.QueryRow(context.Background(), `INSERT INTO wall_images(wall_id,storage_key,is_active,parent_image_id,reset_kind,review_status)
VALUES($1,'pending-reset.jpg',false,$2,'partial','pending') RETURNING id`, e.wallID, e.activeID).Scan(&pendingID); err != nil {
		t.Fatal(err)
	}
	if _, err := e.pool.Exec(context.Background(), `INSERT INTO detection_jobs(wall_image_id,status) VALUES($1,'done')`, pendingID); err != nil {
		t.Fatal(err)
	}
	return pendingID
}

func TestPartialUploadCommitsImageAndJobTogether(t *testing.T) {
	storage := &uploadTestStorage{}
	e := newUploadTestEnv(t, storage)
	response := e.upload("partial")
	if response.Code != http.StatusCreated {
		t.Fatalf("partial upload status=%d body=%s", response.Code, response.Body)
	}

	var activeID, pendingParent uuid.UUID
	var pendingCount, jobCount int
	if err := e.pool.QueryRow(context.Background(), `SELECT id FROM wall_images WHERE wall_id=$1 AND is_active`, e.wallID).Scan(&activeID); err != nil {
		t.Fatal(err)
	}
	if activeID != e.activeID {
		t.Fatalf("partial upload changed active image: got=%s want=%s", activeID, e.activeID)
	}
	if err := e.pool.QueryRow(context.Background(), `SELECT count(*) FROM wall_images WHERE wall_id=$1 AND reset_kind='partial' AND review_status='pending'`, e.wallID).Scan(&pendingCount); err != nil {
		t.Fatal(err)
	}
	if pendingCount != 1 {
		t.Fatalf("pending reset count=%d, want 1", pendingCount)
	}
	if err := e.pool.QueryRow(context.Background(), `SELECT parent_image_id FROM wall_images WHERE wall_id=$1 AND reset_kind='partial' AND review_status='pending'`, e.wallID).Scan(&pendingParent); err != nil {
		t.Fatal(err)
	}
	if pendingParent != e.activeID {
		t.Fatalf("pending reset parent=%s, want %s", pendingParent, e.activeID)
	}
	if err := e.pool.QueryRow(context.Background(), `SELECT count(*) FROM detection_jobs j JOIN wall_images i ON i.id=j.wall_image_id WHERE i.wall_id=$1`, e.wallID).Scan(&jobCount); err != nil {
		t.Fatal(err)
	}
	if jobCount != 1 {
		t.Fatalf("detection job count=%d, want 1", jobCount)
	}
	if len(storage.deleted) != 0 {
		t.Fatalf("unexpected storage cleanup after partial upload: %v", storage.deleted)
	}
}

func TestUploadJobInsertFailureRollsBackAndCleansNewObject(t *testing.T) {
	storage := &uploadTestStorage{}
	e := newUploadTestEnv(t, storage)
	var pendingID uuid.UUID
	if err := e.pool.QueryRow(context.Background(), `INSERT INTO wall_images(wall_id,storage_key,is_active,parent_image_id,reset_kind,review_status)
VALUES($1,'old-pending.jpg',false,$2,'partial','pending') RETURNING id`, e.wallID, e.activeID).Scan(&pendingID); err != nil {
		t.Fatal(err)
	}
	if _, err := e.pool.Exec(context.Background(), `INSERT INTO detection_jobs(wall_image_id,status) VALUES($1,'pending')`, pendingID); err != nil {
		t.Fatal(err)
	}
	if _, err := e.pool.Exec(context.Background(), `CREATE FUNCTION fail_upload_job_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'injected detection-job insert failure'; END $$;
CREATE TRIGGER fail_upload_job_insert BEFORE INSERT ON detection_jobs FOR EACH ROW EXECUTE FUNCTION fail_upload_job_insert()`); err != nil {
		t.Fatal(err)
	}

	response := e.upload("partial")
	if response.Code != http.StatusInternalServerError {
		t.Fatalf("upload status=%d body=%s, want 500", response.Code, response.Body)
	}
	var activeID uuid.UUID
	var oldPendingCount, jobsForNewImage int
	if err := e.pool.QueryRow(context.Background(), `SELECT id FROM wall_images WHERE wall_id=$1 AND is_active`, e.wallID).Scan(&activeID); err != nil {
		t.Fatal(err)
	}
	if activeID != e.activeID {
		t.Fatalf("rollback changed active image: got=%s want=%s", activeID, e.activeID)
	}
	if err := e.pool.QueryRow(context.Background(), `SELECT count(*) FROM wall_images WHERE id=$1 AND review_status='pending' AND storage_key='old-pending.jpg'`, pendingID).Scan(&oldPendingCount); err != nil {
		t.Fatal(err)
	}
	if oldPendingCount != 1 {
		t.Fatalf("old pending reset was not preserved after rollback")
	}
	if err := e.pool.QueryRow(context.Background(), `SELECT count(*) FROM detection_jobs j JOIN wall_images i ON i.id=j.wall_image_id WHERE i.wall_id=$1`, e.wallID).Scan(&jobsForNewImage); err != nil {
		t.Fatal(err)
	}
	if jobsForNewImage != 1 {
		t.Fatalf("job count after rollback=%d, want only the preexisting job", jobsForNewImage)
	}
	if len(storage.uploaded) != 1 || len(storage.deleted) != 1 || storage.deleted[0] != storage.uploaded[0] {
		t.Fatalf("new object cleanup uploaded=%v deleted=%v", storage.uploaded, storage.deleted)
	}
	var newImageCount int
	if err := e.pool.QueryRow(context.Background(), `SELECT count(*) FROM wall_images WHERE storage_key=$1`, storage.uploaded[0]).Scan(&newImageCount); err != nil || newImageCount != 0 {
		t.Fatalf("new image row count=%d err=%v", newImageCount, err)
	}
}

func TestConcurrentFullUploadsSerializeOnWall(t *testing.T) {
	storage := &uploadTestStorage{}
	arrived := make(chan struct{}, 2)
	release := make(chan struct{})
	storage.uploadFn = func(ctx context.Context, _ string) error {
		arrived <- struct{}{}
		select {
		case <-release:
			return nil
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	e := newUploadTestEnv(t, storage)
	responses := make(chan *httptest.ResponseRecorder, 2)
	go func() { responses <- e.upload("full") }()
	go func() { responses <- e.upload("full") }()
	<-arrived
	<-arrived
	close(release)
	for i := 0; i < 2; i++ {
		if response := <-responses; response.Code != http.StatusCreated {
			t.Fatalf("concurrent upload status=%d body=%s", response.Code, response.Body)
		}
	}
	var activeCount, jobCount int
	if err := e.pool.QueryRow(context.Background(), `SELECT count(*) FROM wall_images WHERE wall_id=$1 AND is_active`, e.wallID).Scan(&activeCount); err != nil {
		t.Fatal(err)
	}
	if err := e.pool.QueryRow(context.Background(), `SELECT count(*) FROM detection_jobs j JOIN wall_images i ON i.id=j.wall_image_id WHERE i.wall_id=$1`, e.wallID).Scan(&jobCount); err != nil {
		t.Fatal(err)
	}
	if activeCount != 1 || jobCount != 2 {
		t.Fatalf("after concurrent full uploads active=%d jobs=%d; want 1 and 2", activeCount, jobCount)
	}
}

func TestPartialUploadRacingApplyResetRejectsStaleParent(t *testing.T) {
	storage := &uploadTestStorage{}
	arrived := make(chan struct{}, 1)
	release := make(chan struct{})
	storage.uploadFn = func(ctx context.Context, _ string) error {
		arrived <- struct{}{}
		select {
		case <-release:
			return nil
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	e := newUploadTestEnv(t, storage)
	pendingID := e.createCompletedPendingReset(t)
	uploadResponse := make(chan *httptest.ResponseRecorder, 1)
	go func() { uploadResponse <- e.upload("partial") }()
	<-arrived // the partial upload captured the old active image before S3 completed

	if response := e.applyReset(pendingID); response.Code != http.StatusOK {
		t.Fatalf("apply reset status=%d body=%s", response.Code, response.Body)
	}
	close(release)
	if response := <-uploadResponse; response.Code != http.StatusConflict {
		t.Fatalf("stale partial upload status=%d body=%s, want 409", response.Code, response.Body)
	}
	var activeID uuid.UUID
	if err := e.pool.QueryRow(context.Background(), `SELECT id FROM wall_images WHERE wall_id=$1 AND is_active`, e.wallID).Scan(&activeID); err != nil {
		t.Fatal(err)
	}
	if activeID != pendingID {
		t.Fatalf("active image=%s after apply/upload race, want reset image %s", activeID, pendingID)
	}
	if len(storage.uploaded) != 1 || len(storage.deleted) != 1 || storage.deleted[0] != storage.uploaded[0] {
		t.Fatalf("racing upload cleanup uploaded=%v deleted=%v", storage.uploaded, storage.deleted)
	}
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

	storage := &uploadTestStorage{deleteErr: errors.New("object store unavailable")}
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
