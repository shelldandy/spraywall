package wall

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"regexp"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/bowlinedandy/spraywall/server/db/generated"
	"github.com/bowlinedandy/spraywall/server/internal/shared"
	"github.com/bowlinedandy/spraywall/server/internal/storage"
	"github.com/bowlinedandy/spraywall/server/internal/user"
)

// Handler holds dependencies for gym/wall HTTP handlers.
type Handler struct {
	queries *generated.Queries
	storage *storage.Client
}

// NewHandler creates a new Handler.
func NewHandler(queries *generated.Queries, storageClient *storage.Client) *Handler {
	return &Handler{
		queries: queries,
		storage: storageClient,
	}
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

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v) //nolint:errcheck
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

// requireGymMember loads the gym by slug, verifies the caller is a member,
// and returns the gym and membership.  If the check fails it writes an HTTP
// error and returns a non-nil error.
func (h *Handler) requireGymMember(w http.ResponseWriter, r *http.Request) (generated.Gym, generated.GymMember, error) {
	gymSlug := chi.URLParam(r, "gymSlug")
	gym, err := h.queries.GetGymBySlug(r.Context(), gymSlug)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, http.StatusNotFound, "gym not found")
		} else {
			writeError(w, http.StatusInternalServerError, "database error")
		}
		return generated.Gym{}, generated.GymMember{}, err
	}

	userID := user.GetUserID(r.Context())
	member, err := h.queries.GetGymMember(r.Context(), generated.GetGymMemberParams{
		GymID:  gym.ID,
		UserID: shared.PgUUID(userID),
	})
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

	gym, err := h.queries.CreateGym(r.Context(), generated.CreateGymParams{
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

	// Auto-add creator as admin member.
	if err := h.queries.CreateGymMember(r.Context(), generated.CreateGymMemberParams{
		GymID:  gym.ID,
		UserID: shared.PgUUID(userID),
		Role:   generated.UserRoleAdmin,
	}); err != nil {
		writeError(w, http.StatusInternalServerError, "could not add owner as member")
		return
	}

	writeJSON(w, http.StatusCreated, gym)
}

// ListGyms handles GET /gyms
func (h *Handler) ListGyms(w http.ResponseWriter, r *http.Request) {
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
	if walls == nil {
		walls = []generated.Wall{}
	}
	writeJSON(w, http.StatusOK, walls)
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

	type wallDetail struct {
		Wall            generated.Wall `json:"wall"`
		Image           *imageInfo     `json:"image"`
		DetectionStatus *string        `json:"detection_status"`
		UserRole        string         `json:"user_role"`
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

	// Parse multipart form (max 10 MB).
	if err := r.ParseMultipartForm(10 << 20); err != nil {
		writeError(w, http.StatusBadRequest, "could not parse multipart form")
		return
	}

	file, header, err := r.FormFile("image")
	if err != nil {
		writeError(w, http.StatusBadRequest, "image field is required")
		return
	}
	defer file.Close()

	// Build storage key.
	imageUUID := uuid.New()
	storageKey := fmt.Sprintf("walls/%s/%s.jpg", wallIDStr, imageUUID.String())

	contentType := header.Header.Get("Content-Type")
	if contentType == "" {
		contentType = "image/jpeg"
	}

	if err := h.storage.Upload(r.Context(), storageKey, file, header.Size, contentType); err != nil {
		writeError(w, http.StatusInternalServerError, "could not upload image")
		return
	}

	// Deactivate old images.
	if err := h.queries.DeactivateWallImages(r.Context(), pgWallID); err != nil {
		writeError(w, http.StatusInternalServerError, "could not deactivate old images")
		return
	}

	// Create wall_image record.
	wallImage, err := h.queries.CreateWallImage(r.Context(), generated.CreateWallImageParams{
		WallID:     pgWallID,
		StorageKey: storageKey,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not save image record")
		return
	}

	// Create detection job.
	job, err := h.queries.CreateDetectionJob(r.Context(), wallImage.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not create detection job")
		return
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

// ServeImage handles GET /images/*
func (h *Handler) ServeImage(w http.ResponseWriter, r *http.Request) {
	key := chi.URLParam(r, "*")
	if key == "" {
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
	w.Header().Set("Cache-Control", "public, max-age=86400")
	io.Copy(w, reader)
}
