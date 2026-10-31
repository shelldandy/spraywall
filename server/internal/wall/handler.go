package wall

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"math"
	"net/http"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/bowlinedandy/spraywall/server/db/generated"
	"github.com/bowlinedandy/spraywall/server/internal/gymaccess"
	"github.com/bowlinedandy/spraywall/server/internal/shared"
	"github.com/bowlinedandy/spraywall/server/internal/user"
)

// WallImageStorage contains the object-store operations used by wall handlers.
type WallImageStorage interface {
	Upload(context.Context, string, io.Reader, int64, string) error
	Download(context.Context, string) (io.ReadCloser, string, error)
	Delete(context.Context, string) error
}

// Handler holds dependencies for gym/wall HTTP handlers.
type Handler struct {
	queries *generated.Queries
	storage WallImageStorage
	pool    *pgxpool.Pool
}

// NewHandler creates a new Handler.
func NewHandler(queries *generated.Queries, storageClient WallImageStorage, pool *pgxpool.Pool) *Handler {
	return &Handler{queries: queries, storage: storageClient, pool: pool}
}

// ---------- helpers ----------

var slugRe = regexp.MustCompile(`[^a-z0-9]+`)

var validSlugRe = regexp.MustCompile(`^[a-z0-9]+(?:-[a-z0-9]+)*$`)

func slugify(s string) string {
	slug := strings.ToLower(strings.TrimSpace(s))
	slug = slugRe.ReplaceAllString(slug, "-")
	slug = strings.Trim(slug, "-")
	return slug
}

func isValidSlug(s string) bool {
	return validSlugRe.MatchString(s)
}

func isHEIC(filename, contentType string) bool {
	filename = strings.ToLower(filename)
	contentType = strings.ToLower(strings.SplitN(contentType, ";", 2)[0])
	return strings.HasSuffix(filename, ".heic") ||
		strings.HasSuffix(filename, ".heif") ||
		strings.Contains(contentType, "heic") ||
		strings.Contains(contentType, "heif")
}

func isValidWallImageMode(mode string) bool {
	return mode == "" || mode == "full" || mode == "partial"
}

func (h *Handler) deleteStorageObjectBestEffort(key, reason string) {
	if h.storage == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := h.storage.Delete(ctx, key); err != nil {
		log.Printf("wall: could not delete image object %q (%s): %v", key, reason, err)
		queueCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if _, queueErr := h.pool.Exec(queueCtx, `INSERT INTO storage_deletions (storage_key) VALUES ($1)`, key); queueErr != nil {
			log.Printf("wall: could not queue image delete %q: %v", key, queueErr)
		}
	}
}

const (
	maxWallImageRequestSize = 20 << 20
	maxHEICImagePixels      = 64_000_000
	maxHEICImageDimension   = 10_000
)

func convertHEICToJPEG(ctx context.Context, src io.ReadSeeker) ([]byte, error) {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	if err := validateHEICDimensions(ctx, src); err != nil {
		return nil, err
	}
	if _, err := src.Seek(0, io.SeekStart); err != nil {
		return nil, fmt.Errorf("rewind HEIC image: %w", err)
	}

	cmd := exec.CommandContext(ctx, "magick",
		"-limit", "memory", "256MiB",
		"-limit", "map", "512MiB",
		"-limit", "disk", "512MiB",
		"-limit", "time", "30",
		"-limit", "area", strconv.Itoa(maxHEICImagePixels),
		"-limit", "width", "10000",
		"-limit", "height", "10000",
		"-limit", "thread", "2",
		"-", "-auto-orient", "-strip", "-quality", "85", "jpeg:-")
	cmd.Stdin = src

	var output, stderr bytes.Buffer
	cmd.Stdout = &output
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf("convert HEIC to JPEG: %w: %s", err, strings.TrimSpace(stderr.String()))
	}
	return output.Bytes(), nil
}

func validateHEICDimensions(ctx context.Context, src io.ReadSeeker) error {
	if _, err := src.Seek(0, io.SeekStart); err != nil {
		return fmt.Errorf("rewind HEIC image for dimension check: %w", err)
	}

	cmd := exec.CommandContext(ctx, "magick", "identify",
		"-ping",
		"-limit", "memory", "64MiB",
		"-limit", "map", "128MiB",
		"-limit", "disk", "128MiB",
		"-limit", "time", "10",
		"-limit", "list-length", "2",
		"-format", "%w %h", "-")
	cmd.Stdin = src

	var output, stderr bytes.Buffer
	cmd.Stdout = &output
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("read HEIC dimensions: %w: %s", err, strings.TrimSpace(stderr.String()))
	}

	dimensions := strings.Fields(output.String())
	if len(dimensions) != 2 {
		return fmt.Errorf("could not read HEIC dimensions")
	}
	width, err := strconv.ParseInt(dimensions[0], 10, 64)
	if err != nil {
		return fmt.Errorf("invalid HEIC width: %w", err)
	}
	height, err := strconv.ParseInt(dimensions[1], 10, 64)
	if err != nil {
		return fmt.Errorf("invalid HEIC height: %w", err)
	}
	if width <= 0 || height <= 0 || width > maxHEICImageDimension || height > maxHEICImageDimension || width > maxHEICImagePixels/height {
		return fmt.Errorf("HEIC dimensions %dx%d exceed the %d-pixel limit", width, height, maxHEICImagePixels)
	}
	return nil
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v) //nolint:errcheck
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

// requireGymMember loads the gym by slug, verifies the caller is a member
// (instance admins count as admins of every gym),
// and returns the gym and membership.  If the check fails it writes an HTTP
// error and returns a non-nil error.
func (h *Handler) requireGymMember(w http.ResponseWriter, r *http.Request) (generated.Gym, generated.GymMember, error) {
	return gymaccess.RequireGymMember(w, r, h.queries)
}

// ---------- endpoints ----------

// CreateGym handles POST /gyms
func (h *Handler) CreateGym(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name string `json:"name"`
		Slug string `json:"slug"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Name == "" {
		writeError(w, http.StatusBadRequest, "name is required")
		return
	}

	userID := user.GetUserID(r.Context())
	slug := body.Slug
	if slug == "" {
		slug = slugify(body.Name)
	}
	if slug == "" || !isValidSlug(slug) {
		writeError(w, http.StatusBadRequest, "invalid slug")
		return
	}

	tx, err := h.pool.Begin(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not create gym")
		return
	}
	defer tx.Rollback(r.Context())

	txq := h.queries.WithTx(tx)
	gym, err := txq.CreateGym(r.Context(), generated.CreateGymParams{
		Name:    body.Name,
		Slug:    slug,
		OwnerID: shared.PgUUID(userID),
	})
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			writeError(w, http.StatusConflict, "gym slug already taken")
			return
		}
		writeError(w, http.StatusInternalServerError, "could not create gym")
		return
	}

	if err := txq.CreateGymMember(r.Context(), generated.CreateGymMemberParams{
		GymID:  gym.ID,
		UserID: shared.PgUUID(userID),
		Role:   generated.UserRoleAdmin,
	}); err != nil {
		writeError(w, http.StatusInternalServerError, "could not add owner as member")
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		writeError(w, http.StatusInternalServerError, "could not create gym")
		return
	}

	writeJSON(w, http.StatusCreated, gym)
}

// ListGyms handles GET /gyms. Instance admins (by current account role) see
// every gym.
func (h *Handler) ListGyms(w http.ResponseWriter, r *http.Request) {
	if user.GetUserRole(r.Context()) == string(generated.UserRoleAdmin) {
		all, err := h.queries.ListAllGymsAsAdmin(r.Context())
		if err != nil {
			writeError(w, http.StatusInternalServerError, "could not list gyms")
			return
		}
		gyms := make([]generated.ListGymsByUserRow, 0, len(all))
		for _, g := range all {
			gyms = append(gyms, generated.ListGymsByUserRow(g))
		}
		writeJSON(w, http.StatusOK, gyms)
		return
	}

	userID := user.GetUserID(r.Context())
	gyms, err := h.queries.ListGymsByUser(r.Context(), shared.PgUUID(userID))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not list gyms")
		return
	}
	if gyms == nil {
		gyms = []generated.ListGymsByUserRow{}
	}
	writeJSON(w, http.StatusOK, gyms)
}

// GetGym handles GET /gyms/{gymSlug}
func (h *Handler) GetGym(w http.ResponseWriter, r *http.Request) {
	gym, _, err := h.requireGymMember(w, r)
	if err != nil {
		return
	}
	writeJSON(w, http.StatusOK, gym)
}

// AddMember handles POST /gyms/{gymSlug}/members
func (h *Handler) AddMember(w http.ResponseWriter, r *http.Request) {
	gym, member, err := h.requireGymMember(w, r)
	if err != nil {
		return
	}

	// Only gym admins can add members.
	if member.Role != generated.UserRoleAdmin {
		writeError(w, http.StatusForbidden, "only gym admins can add members")
		return
	}

	var body struct {
		Email string `json:"email"`
		Role  string `json:"role"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Email == "" {
		writeError(w, http.StatusBadRequest, "email is required")
		return
	}

	role := generated.UserRole(body.Role)
	if role != generated.UserRoleAdmin && role != generated.UserRoleSetter && role != generated.UserRoleClimber {
		role = generated.UserRoleClimber
	}

	// Look up user by email.
	targetUser, err := h.queries.GetUserByEmail(r.Context(), body.Email)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, http.StatusNotFound, "user not found")
		} else {
			writeError(w, http.StatusInternalServerError, "database error")
		}
		return
	}

	if err := h.queries.CreateGymMember(r.Context(), generated.CreateGymMemberParams{
		GymID:  gym.ID,
		UserID: targetUser.ID,
		Role:   role,
	}); err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			writeError(w, http.StatusConflict, "user is already a member")
			return
		}
		writeError(w, http.StatusInternalServerError, "could not add member")
		return
	}

	member, err = h.queries.GetGymMember(r.Context(), generated.GetGymMemberParams{
		GymID:  gym.ID,
		UserID: targetUser.ID,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not fetch created member")
		return
	}
	writeJSON(w, http.StatusCreated, member)
}

// CreateWall handles POST /gyms/{gymSlug}/walls
func (h *Handler) CreateWall(w http.ResponseWriter, r *http.Request) {
	gym, member, err := h.requireGymMember(w, r)
	if err != nil {
		return
	}

	if member.Role != generated.UserRoleAdmin && member.Role != generated.UserRoleSetter {
		writeError(w, http.StatusForbidden, "only setters or admins can create walls")
		return
	}

	var body struct {
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Name == "" {
		writeError(w, http.StatusBadRequest, "name is required")
		return
	}

	wall, err := h.queries.CreateWall(r.Context(), generated.CreateWallParams{
		GymID: gym.ID,
		Name:  body.Name,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not create wall")
		return
	}

	writeJSON(w, http.StatusCreated, wall)
}

// ListWalls handles GET /gyms/{gymSlug}/walls
func (h *Handler) ListWalls(w http.ResponseWriter, r *http.Request) {
	gym, _, err := h.requireGymMember(w, r)
	if err != nil {
		return
	}

	walls, err := h.queries.ListWallsByGym(r.Context(), gym.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not list walls")
		return
	}

	type wallListItem struct {
		generated.Wall
		PreviewImageURL *string `json:"preview_image_url"`
	}
	items := make([]wallListItem, 0, len(walls))
	for _, wall := range walls {
		item := wallListItem{
			Wall: generated.Wall{
				ID:        wall.ID,
				GymID:     wall.GymID,
				Name:      wall.Name,
				CreatedAt: wall.CreatedAt,
			},
		}
		if wall.PreviewStorageKey != "" {
			url := "/images/" + wall.PreviewStorageKey
			item.PreviewImageURL = &url
		}
		items = append(items, item)
	}
	writeJSON(w, http.StatusOK, items)
}

// GetWall handles GET /gyms/{gymSlug}/walls/{wallId}
func (h *Handler) GetWall(w http.ResponseWriter, r *http.Request) {
	gym, member, err := h.requireGymMember(w, r)
	if err != nil {
		return
	}

	wallIDStr := chi.URLParam(r, "wallId")
	wallUUID, err := uuid.Parse(wallIDStr)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid wall id")
		return
	}

	wall, err := h.queries.GetWallByID(r.Context(), shared.PgUUID(wallUUID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, http.StatusNotFound, "wall not found")
		} else {
			writeError(w, http.StatusInternalServerError, "database error")
		}
		return
	}
	if wall.GymID != gym.ID {
		writeError(w, http.StatusNotFound, "wall not found")
		return
	}

	type imageInfo struct {
		ID        string             `json:"id"`
		ImageURL  string             `json:"image_url"`
		IsActive  bool               `json:"is_active"`
		CreatedAt pgtype.Timestamptz `json:"created_at"`
	}

	type pendingResetInfo struct {
		ImageID         string             `json:"image_id"`
		ImageURL        string             `json:"image_url"`
		DetectionStatus *string            `json:"detection_status"`
		CreatedAt       pgtype.Timestamptz `json:"created_at"`
	}
	type wallDetail struct {
		Wall            generated.Wall    `json:"wall"`
		Image           *imageInfo        `json:"image"`
		DetectionStatus *string           `json:"detection_status"`
		PendingReset    *pendingResetInfo `json:"pending_reset,omitempty"`
		UserRole        string            `json:"user_role"`
	}

	detail := wallDetail{Wall: wall, UserRole: string(member.Role)}

	// Try to get the active image and its detection status.
	img, err := h.queries.GetActiveWallImage(r.Context(), wall.ID)
	if err == nil {
		detail.Image = &imageInfo{
			ID:        shared.UUIDFromPg(img.ID).String(),
			ImageURL:  "/images/" + img.StorageKey,
			IsActive:  img.IsActive,
			CreatedAt: img.CreatedAt,
		}

		job, jobErr := h.queries.GetDetectionJobByWallImage(r.Context(), img.ID)
		if jobErr == nil {
			detail.DetectionStatus = &job.Status
		}
	}

	if member.Role == generated.UserRoleAdmin || member.Role == generated.UserRoleSetter {
		pending, pendingErr := h.queries.GetPendingResetImage(r.Context(), wall.ID)
		if pendingErr == nil {
			pendingInfo := &pendingResetInfo{
				ImageID: shared.UUIDFromPg(pending.ID).String(), ImageURL: "/images/" + pending.StorageKey,
				CreatedAt: pending.CreatedAt,
			}
			if job, jobErr := h.queries.GetDetectionJobByWallImage(r.Context(), pending.ID); jobErr == nil {
				pendingInfo.DetectionStatus = &job.Status
			}
			detail.PendingReset = pendingInfo
		} else if !errors.Is(pendingErr, pgx.ErrNoRows) {
			writeError(w, http.StatusInternalServerError, "could not load pending reset")
			return
		}
	}
	writeJSON(w, http.StatusOK, detail)
}

// UploadImage handles POST /gyms/{gymSlug}/walls/{wallId}/images
func (h *Handler) UploadImage(w http.ResponseWriter, r *http.Request) {
	gym, member, err := h.requireGymMember(w, r)
	if err != nil {
		return
	}

	if member.Role != generated.UserRoleAdmin && member.Role != generated.UserRoleSetter {
		writeError(w, http.StatusForbidden, "only setters or admins can upload images")
		return
	}

	wallIDStr := chi.URLParam(r, "wallId")
	wallUUID, err := uuid.Parse(wallIDStr)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid wall id")
		return
	}
	pgWallID := shared.PgUUID(wallUUID)

	// Verify wall exists and belongs to this gym.
	wall, err := h.queries.GetWallByID(r.Context(), pgWallID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, http.StatusNotFound, "wall not found")
		} else {
			writeError(w, http.StatusInternalServerError, "database error")
		}
		return
	}
	if wall.GymID != gym.ID {
		writeError(w, http.StatusNotFound, "wall not found")
		return
	}

	// Limit the complete multipart request; ParseMultipartForm's argument only
	// controls the in-memory threshold before parts spill to disk.
	r.Body = http.MaxBytesReader(w, r.Body, maxWallImageRequestSize)
	if err := r.ParseMultipartForm(10 << 20); err != nil {
		var maxBytesErr *http.MaxBytesError
		if errors.As(err, &maxBytesErr) {
			writeError(w, http.StatusRequestEntityTooLarge, "image upload too large")
		} else {
			writeError(w, http.StatusBadRequest, "could not parse multipart form")
		}
		return
	}
	if r.MultipartForm != nil {
		defer r.MultipartForm.RemoveAll()
	}

	file, header, err := r.FormFile("image")
	if err != nil {
		writeError(w, http.StatusBadRequest, "image field is required")
		return
	}
	defer file.Close()

	mode := r.FormValue("mode")
	if !isValidWallImageMode(mode) {
		writeError(w, http.StatusBadRequest, "invalid image upload mode")
		return
	}
	var activeImage generated.WallImage
	if mode == "partial" {
		activeImage, err = h.queries.GetActiveWallImage(r.Context(), pgWallID)
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, http.StatusConflict, "partial reset requires an active image")
			return
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, "could not load active image")
			return
		}
	}

	// Build storage key.
	imageUUID := uuid.New()
	storageKey := fmt.Sprintf("walls/%s/%s.jpg", wallIDStr, imageUUID.String())

	contentType := header.Header.Get("Content-Type")
	if contentType == "" {
		contentType = "image/jpeg"
	}

	var uploadReader io.Reader = file
	uploadSize := header.Size
	if isHEIC(header.Filename, contentType) {
		jpegBytes, err := convertHEICToJPEG(r.Context(), file)
		if err != nil {
			writeError(w, http.StatusBadRequest, "could not convert HEIC image to JPEG")
			return
		}
		uploadReader = bytes.NewReader(jpegBytes)
		uploadSize = int64(len(jpegBytes))
		contentType = "image/jpeg"
	}

	if err := h.storage.Upload(r.Context(), storageKey, uploadReader, uploadSize, contentType); err != nil {
		writeError(w, http.StatusInternalServerError, "could not upload image")
		return
	}

	tx, err := h.pool.Begin(r.Context())
	if err != nil {
		h.deleteStorageObjectBestEffort(storageKey, "database transaction could not start")
		writeError(w, http.StatusInternalServerError, "could not save image record")
		return
	}
	rollbackUpload := func() {
		if rollbackErr := tx.Rollback(context.Background()); rollbackErr != nil && !errors.Is(rollbackErr, pgx.ErrTxClosed) {
			log.Printf("wall: rollback image upload %q: %v", storageKey, rollbackErr)
		}
		h.deleteStorageObjectBestEffort(storageKey, "database transaction rolled back")
	}

	// Serialize every upload/reset transition on the wall row. Storage upload
	// and HEIC conversion have already completed, so this transaction stays short.
	var lockedWall pgtype.UUID
	if err := tx.QueryRow(r.Context(), `SELECT id FROM walls WHERE id=$1 AND gym_id=$2 FOR UPDATE`, pgWallID, gym.ID).Scan(&lockedWall); err != nil {
		rollbackUpload()
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, http.StatusNotFound, "wall not found")
		} else {
			writeError(w, http.StatusInternalServerError, "could not lock wall for upload")
		}
		return
	}

	txQueries := h.queries.WithTx(tx)
	if mode == "partial" {
		currentImage, imageErr := txQueries.GetActiveWallImage(r.Context(), pgWallID)
		if errors.Is(imageErr, pgx.ErrNoRows) || (imageErr == nil && currentImage.ID != activeImage.ID) {
			rollbackUpload()
			writeError(w, http.StatusConflict, "active wall image changed during partial upload")
			return
		}
		if imageErr != nil {
			rollbackUpload()
			writeError(w, http.StatusInternalServerError, "could not reload active image")
			return
		}
	}

	oldPendingKeys, err := txQueries.DeletePendingResetImagesByWall(r.Context(), pgWallID)
	if err != nil {
		rollbackUpload()
		writeError(w, http.StatusInternalServerError, "could not clear pending reset")
		return
	}

	var wallImage generated.WallImage
	if mode == "partial" {
		wallImage, err = txQueries.CreatePendingResetImage(r.Context(), generated.CreatePendingResetImageParams{
			WallID: pgWallID, StorageKey: storageKey, ParentImageID: activeImage.ID,
		})
	} else {
		if err := txQueries.DeactivateWallImages(r.Context(), pgWallID); err != nil {
			rollbackUpload()
			writeError(w, http.StatusInternalServerError, "could not deactivate old images")
			return
		}
		wallImage, err = txQueries.CreateWallImage(r.Context(), generated.CreateWallImageParams{WallID: pgWallID, StorageKey: storageKey})
	}
	if err != nil {
		rollbackUpload()
		writeError(w, http.StatusInternalServerError, "could not save image record")
		return
	}

	job, err := txQueries.CreateDetectionJob(r.Context(), wallImage.ID)
	if err != nil {
		rollbackUpload()
		writeError(w, http.StatusInternalServerError, "could not create detection job")
		return
	}

	if err := tx.Commit(r.Context()); err != nil {
		// Commit errors are ambiguous: retain the object unless the primary DB
		// confirms the new image row is absent.
		checkCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		var exists bool
		checkErr := h.pool.QueryRow(checkCtx, `SELECT EXISTS(SELECT 1 FROM wall_images WHERE id=$1 AND storage_key=$2)`, wallImage.ID, storageKey).Scan(&exists)
		if checkErr == nil && !exists {
			h.deleteStorageObjectBestEffort(storageKey, "commit failed and image row is absent")
		} else {
			log.Printf("wall: ambiguous image upload commit for %q (image=%s, rowExists=%v, checkErr=%v, commitErr=%v); retaining object for reconciliation", storageKey, shared.UUIDFromPg(wallImage.ID), exists, checkErr, err)
		}
		writeError(w, http.StatusInternalServerError, "could not commit image upload")
		return
	}

	// Old objects are removed only after the DB commit is confirmed. Their
	// cleanup is best-effort and must not turn a successful upload into failure.
	for _, key := range oldPendingKeys {
		h.deleteStorageObjectBestEffort(key, "superseded pending reset")
	}

	writeJSON(w, http.StatusCreated, map[string]any{
		"wall_image": wallImage,
		"job":        job,
	})
}

// GetHolds handles GET /gyms/{gymSlug}/walls/{wallId}/holds
func (h *Handler) GetHolds(w http.ResponseWriter, r *http.Request) {
	gym, _, err := h.requireGymMember(w, r)
	if err != nil {
		return
	}

	wallIDStr := chi.URLParam(r, "wallId")
	wallUUID, err := uuid.Parse(wallIDStr)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid wall id")
		return
	}

	wall, err := h.queries.GetWallByID(r.Context(), shared.PgUUID(wallUUID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, http.StatusNotFound, "wall not found")
		} else {
			writeError(w, http.StatusInternalServerError, "database error")
		}
		return
	}
	if wall.GymID != gym.ID {
		writeError(w, http.StatusNotFound, "wall not found")
		return
	}

	// Get active image for this wall.
	img, err := h.queries.GetActiveWallImage(r.Context(), wall.ID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, http.StatusNotFound, "no active image for this wall")
		} else {
			writeError(w, http.StatusInternalServerError, "database error")
		}
		return
	}

	holds, err := h.queries.GetHoldsByWallImage(r.Context(), img.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not fetch holds")
		return
	}

	type holdResponse struct {
		ID          pgtype.UUID        `json:"id"`
		WallImageID pgtype.UUID        `json:"wall_image_id"`
		Bbox        json.RawMessage    `json:"bbox"`
		Polygon     json.RawMessage    `json:"polygon"`
		Confidence  float32            `json:"confidence"`
		CreatedAt   pgtype.Timestamptz `json:"created_at"`
	}

	result := make([]holdResponse, len(holds))
	for i, h := range holds {
		result[i] = holdResponse{
			ID:          h.ID,
			WallImageID: h.WallImageID,
			Bbox:        json.RawMessage(h.Bbox),
			Polygon:     json.RawMessage(h.Polygon),
			Confidence:  h.Confidence,
			CreatedAt:   h.CreatedAt,
		}
	}
	writeJSON(w, http.StatusOK, result)
}

// CreateHold handles POST /gyms/{gymSlug}/walls/{wallId}/holds
func (h *Handler) CreateHold(w http.ResponseWriter, r *http.Request) {
	gym, member, err := h.requireGymMember(w, r)
	if err != nil {
		return
	}

	if member.Role != generated.UserRoleAdmin && member.Role != generated.UserRoleSetter {
		writeError(w, http.StatusForbidden, "only setters or admins can add holds")
		return
	}

	wallIDStr := chi.URLParam(r, "wallId")
	wallUUID, err := uuid.Parse(wallIDStr)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid wall id")
		return
	}

	wall, err := h.queries.GetWallByID(r.Context(), shared.PgUUID(wallUUID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, http.StatusNotFound, "wall not found")
		} else {
			writeError(w, http.StatusInternalServerError, "database error")
		}
		return
	}
	if wall.GymID != gym.ID {
		writeError(w, http.StatusNotFound, "wall not found")
		return
	}

	img, err := h.queries.GetActiveWallImage(r.Context(), wall.ID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, http.StatusNotFound, "no active image for this wall")
		} else {
			writeError(w, http.StatusInternalServerError, "database error")
		}
		return
	}

	var body struct {
		Bbox struct {
			X float64 `json:"x"`
			Y float64 `json:"y"`
			W float64 `json:"w"`
			H float64 `json:"h"`
		} `json:"bbox"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}

	b := body.Bbox
	if math.IsNaN(b.X) || math.IsNaN(b.Y) || math.IsNaN(b.W) || math.IsNaN(b.H) ||
		math.IsInf(b.X, 0) || math.IsInf(b.Y, 0) || math.IsInf(b.W, 0) || math.IsInf(b.H, 0) ||
		b.W <= 0 || b.H <= 0 ||
		b.X < 0 || b.Y < 0 || b.X > 1 || b.Y > 1 || b.W > 1 || b.H > 1 || b.X+b.W > 1 || b.Y+b.H > 1 {
		writeError(w, http.StatusBadRequest, "bbox values must be between 0 and 1 with w,h > 0, and x+w<=1, y+h<=1")
		return
	}

	bboxJSON, err := json.Marshal(b)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not marshal bbox")
		return
	}

	hold, err := h.queries.CreateHold(r.Context(), generated.CreateHoldParams{
		WallImageID: img.ID,
		Bbox:        bboxJSON,
		Confidence:  1.0,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not create hold")
		return
	}

	type holdResponse struct {
		ID          pgtype.UUID        `json:"id"`
		WallImageID pgtype.UUID        `json:"wall_image_id"`
		Bbox        json.RawMessage    `json:"bbox"`
		Polygon     json.RawMessage    `json:"polygon"`
		Confidence  float32            `json:"confidence"`
		CreatedAt   pgtype.Timestamptz `json:"created_at"`
	}

	resp := holdResponse{
		ID:          hold.ID,
		WallImageID: hold.WallImageID,
		Bbox:        json.RawMessage(hold.Bbox),
		Polygon:     json.RawMessage(hold.Polygon),
		Confidence:  hold.Confidence,
		CreatedAt:   hold.CreatedAt,
	}
	writeJSON(w, http.StatusCreated, resp)
}

// DeleteHold handles DELETE /gyms/{gymSlug}/walls/{wallId}/holds/{holdId}
func (h *Handler) DeleteHold(w http.ResponseWriter, r *http.Request) {
	gym, member, err := h.requireGymMember(w, r)
	if err != nil {
		return
	}

	if member.Role != generated.UserRoleAdmin && member.Role != generated.UserRoleSetter {
		writeError(w, http.StatusForbidden, "only setters or admins can delete holds")
		return
	}

	wallIDStr := chi.URLParam(r, "wallId")
	wallUUID, err := uuid.Parse(wallIDStr)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid wall id")
		return
	}

	wall, err := h.queries.GetWallByID(r.Context(), shared.PgUUID(wallUUID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, http.StatusNotFound, "wall not found")
		} else {
			writeError(w, http.StatusInternalServerError, "database error")
		}
		return
	}
	if wall.GymID != gym.ID {
		writeError(w, http.StatusNotFound, "wall not found")
		return
	}

	img, err := h.queries.GetActiveWallImage(r.Context(), wall.ID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, http.StatusNotFound, "no active image for this wall")
		} else {
			writeError(w, http.StatusInternalServerError, "database error")
		}
		return
	}

	holdIDStr := chi.URLParam(r, "holdId")
	holdUUID, err := uuid.Parse(holdIDStr)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid hold id")
		return
	}

	if _, err := h.queries.DeleteHold(r.Context(), generated.DeleteHoldParams{
		ID:          shared.PgUUID(holdUUID),
		WallImageID: img.ID,
	}); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, http.StatusNotFound, "hold not found")
		} else {
			writeError(w, http.StatusInternalServerError, "could not delete hold")
		}
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func wallStorageKeys(ctx context.Context, tx pgx.Tx, wallID pgtype.UUID) ([]string, error) {
	rows, err := tx.Query(ctx, `SELECT storage_key FROM wall_images WHERE wall_id=$1`, wallID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var keys []string
	for rows.Next() {
		var key string
		if err := rows.Scan(&key); err != nil {
			return nil, err
		}
		keys = append(keys, key)
	}
	return keys, rows.Err()
}

func queueStoredImages(ctx context.Context, tx pgx.Tx, keys []string) error {
	if len(keys) == 0 {
		return nil
	}
	_, err := tx.Exec(ctx, `INSERT INTO storage_deletions (storage_key) SELECT unnest($1::text[])`, keys)
	return err
}

func (h *Handler) deleteNextStoredImage(ctx context.Context) (bool, error) {
	if h.storage == nil {
		return false, errors.New("image storage is unavailable")
	}
	tx, err := h.pool.Begin(ctx)
	if err != nil {
		return false, err
	}
	defer tx.Rollback(ctx)

	var id int64
	var key string
	var attempts int32
	err = tx.QueryRow(ctx, `SELECT id, storage_key, attempts FROM storage_deletions
		WHERE next_attempt_at <= clock_timestamp() ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED`).Scan(&id, &key, &attempts)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}

	cleanupCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	err = h.storage.Delete(cleanupCtx, key)
	cancel()
	if err != nil {
		// shortcut: fixed one-minute retries, add backoff if failures create sustained storage traffic.
		if _, updateErr := tx.Exec(ctx, `UPDATE storage_deletions
			SET attempts=attempts+1, next_attempt_at=clock_timestamp()+interval '1 minute' WHERE id=$1`, id); updateErr != nil {
			return false, fmt.Errorf("record failed image delete: %w", updateErr)
		}
		if commitErr := tx.Commit(ctx); commitErr != nil {
			return false, commitErr
		}
		return true, fmt.Errorf("delete image %q on attempt %d: %w", key, attempts+1, err)
	}
	if _, err := tx.Exec(ctx, `DELETE FROM storage_deletions WHERE id=$1`, id); err != nil {
		return false, err
	}
	if err := tx.Commit(ctx); err != nil {
		return false, err
	}
	return true, nil
}

// RunStorageDeleteQueue retries object deletes saved by wall and gym deletion.
func (h *Handler) RunStorageDeleteQueue(ctx context.Context) {
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()
	for {
		didWork, err := h.deleteNextStoredImage(ctx)
		if err != nil {
			log.Printf("wall: storage delete queue: %v", err)
		}
		if didWork {
			continue
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

// DeleteGym handles DELETE /gyms/{gymSlug}
func (h *Handler) DeleteGym(w http.ResponseWriter, r *http.Request) {
	_, member, err := h.requireGymMember(w, r)
	if err != nil {
		return
	}
	if member.Role != generated.UserRoleAdmin {
		writeError(w, http.StatusForbidden, "only gym admins can delete gyms")
		return
	}

	tx, err := h.pool.Begin(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not delete gym")
		return
	}
	defer tx.Rollback(r.Context())

	var gymID pgtype.UUID
	if err := tx.QueryRow(r.Context(), `SELECT id FROM gyms WHERE id=$1 FOR UPDATE`, member.GymID).Scan(&gymID); err != nil {
		writeError(w, http.StatusInternalServerError, "could not delete gym")
		return
	}
	walls, err := tx.Query(r.Context(), `SELECT id FROM walls WHERE gym_id=$1 ORDER BY id FOR UPDATE`, gymID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not delete gym")
		return
	}
	for walls.Next() {
		var id pgtype.UUID
		if err := walls.Scan(&id); err != nil {
			walls.Close()
			writeError(w, http.StatusInternalServerError, "could not delete gym")
			return
		}
	}
	if err := walls.Err(); err != nil {
		walls.Close()
		writeError(w, http.StatusInternalServerError, "could not delete gym")
		return
	}
	walls.Close()

	rows, err := tx.Query(r.Context(), `SELECT wi.storage_key FROM wall_images wi JOIN walls w ON w.id=wi.wall_id WHERE w.gym_id=$1`, gymID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not delete gym")
		return
	}
	var keys []string
	for rows.Next() {
		var key string
		if err := rows.Scan(&key); err != nil {
			rows.Close()
			writeError(w, http.StatusInternalServerError, "could not delete gym")
			return
		}
		keys = append(keys, key)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		writeError(w, http.StatusInternalServerError, "could not delete gym")
		return
	}
	rows.Close()

	if err := queueStoredImages(r.Context(), tx, keys); err != nil {
		writeError(w, http.StatusInternalServerError, "could not delete gym")
		return
	}
	if err := h.queries.WithTx(tx).DeleteGym(r.Context(), member.GymID); err != nil {
		writeError(w, http.StatusInternalServerError, "could not delete gym")
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		writeError(w, http.StatusInternalServerError, "could not delete gym")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// DeleteWall handles DELETE /gyms/{gymSlug}/walls/{wallId}
func (h *Handler) DeleteWall(w http.ResponseWriter, r *http.Request) {
	gym, member, err := h.requireGymMember(w, r)
	if err != nil {
		return
	}

	if member.Role != generated.UserRoleAdmin && member.Role != generated.UserRoleSetter {
		writeError(w, http.StatusForbidden, "only setters or admins can delete walls")
		return
	}

	wallIDStr := chi.URLParam(r, "wallId")
	wallUUID, err := uuid.Parse(wallIDStr)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid wall id")
		return
	}

	wall, err := h.queries.GetWallByID(r.Context(), shared.PgUUID(wallUUID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, http.StatusNotFound, "wall not found")
		} else {
			writeError(w, http.StatusInternalServerError, "database error")
		}
		return
	}
	if wall.GymID != gym.ID {
		writeError(w, http.StatusNotFound, "wall not found")
		return
	}

	tx, err := h.pool.Begin(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not delete wall")
		return
	}
	defer tx.Rollback(r.Context())
	var lockedID pgtype.UUID
	if err := tx.QueryRow(r.Context(), `SELECT id FROM walls WHERE id=$1 AND gym_id=$2 FOR UPDATE`, wall.ID, gym.ID).Scan(&lockedID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, http.StatusNotFound, "wall not found")
		} else {
			writeError(w, http.StatusInternalServerError, "could not delete wall")
		}
		return
	}
	keys, err := wallStorageKeys(r.Context(), tx, wall.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not delete wall")
		return
	}
	if err := queueStoredImages(r.Context(), tx, keys); err != nil {
		writeError(w, http.StatusInternalServerError, "could not delete wall")
		return
	}
	if err := h.queries.WithTx(tx).DeleteWall(r.Context(), generated.DeleteWallParams{ID: wall.ID, GymID: gym.ID}); err != nil {
		writeError(w, http.StatusInternalServerError, "could not delete wall")
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		writeError(w, http.StatusInternalServerError, "could not delete wall")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ServeImage handles GET /images/*
func (h *Handler) ServeImage(w http.ResponseWriter, r *http.Request) {
	key := chi.URLParam(r, "*")
	if key == "" {
		http.NotFound(w, r)
		return
	}

	var referenced bool
	if err := h.pool.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM wall_images WHERE storage_key=$1) OR EXISTS(SELECT 1 FROM users WHERE avatar_key=$1)`, key).Scan(&referenced); err != nil {
		http.Error(w, "image unavailable", http.StatusInternalServerError)
		return
	}
	if !referenced {
		http.NotFound(w, r)
		return
	}

	reader, contentType, err := h.storage.Download(r.Context(), key)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer reader.Close()

	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Content-Security-Policy", "sandbox; default-src 'none'")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cache-Control", "public, max-age=86400")
	io.Copy(w, reader)
}
