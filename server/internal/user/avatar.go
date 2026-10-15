package user

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"log"
	"net/http"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/bowlinedandy/spraywall/server/db/generated"
)

const (
	// MaxAvatarSize is the largest avatar image accepted, in bytes.
	MaxAvatarSize = 5 << 20

	AvatarSourceUpload = "upload"
	AvatarSourceOIDC   = "oidc"
)

// AvatarStorage is the subset of the object storage client used for avatars.
type AvatarStorage interface {
	Upload(ctx context.Context, key string, reader io.Reader, size int64, contentType string) error
	Delete(ctx context.Context, key string) error
}

var avatarExtensions = map[string]string{
	"image/jpeg": "jpg",
	"image/png":  "png",
	"image/webp": "webp",
	"image/gif":  "gif",
}

// SniffAvatarType returns the detected content type and file extension of an
// avatar image, or ok=false when the data is not an accepted image format.
func SniffAvatarType(data []byte) (contentType, ext string, ok bool) {
	contentType = http.DetectContentType(data)
	ext, ok = avatarExtensions[contentType]
	return contentType, ext, ok
}

// AvatarURL returns the public URL for the user's avatar, or nil if unset.
func AvatarURL(u generated.User) *string {
	if !u.AvatarKey.Valid || u.AvatarKey.String == "" {
		return nil
	}
	url := "/images/" + u.AvatarKey.String
	return &url
}

// SetAvatar stores data as the user's new avatar, records its source (and,
// for OIDC pictures, the origin URL), and deletes the previous object.
func SetAvatar(ctx context.Context, store AvatarStorage, q *generated.Queries, u generated.User, data []byte, source, originURL string) (generated.User, error) {
	if len(data) > MaxAvatarSize {
		return u, fmt.Errorf("avatar exceeds %d bytes", MaxAvatarSize)
	}
	contentType, ext, ok := SniffAvatarType(data)
	if !ok {
		return u, fmt.Errorf("unsupported avatar content type %q", contentType)
	}

	key := fmt.Sprintf("avatars/%s.%s", uuid.New().String(), ext)
	if err := store.Upload(ctx, key, bytes.NewReader(data), int64(len(data)), contentType); err != nil {
		return u, fmt.Errorf("upload avatar: %w", err)
	}

	updated, err := q.UpdateUserAvatar(ctx, generated.UpdateUserAvatarParams{
		ID:              u.ID,
		AvatarKey:       pgtype.Text{String: key, Valid: true},
		AvatarSource:    pgtype.Text{String: source, Valid: true},
		AvatarOriginUrl: pgtype.Text{String: originURL, Valid: originURL != ""},
	})
	if err != nil {
		deleteAvatarObject(ctx, store, key)
		return u, fmt.Errorf("save avatar: %w", err)
	}

	if u.AvatarKey.Valid && u.AvatarKey.String != "" {
		deleteAvatarObject(ctx, store, u.AvatarKey.String)
	}
	return updated, nil
}

// ClearAvatar removes the user's avatar and deletes the stored object.
func ClearAvatar(ctx context.Context, store AvatarStorage, q *generated.Queries, u generated.User) (generated.User, error) {
	updated, err := q.UpdateUserAvatar(ctx, generated.UpdateUserAvatarParams{ID: u.ID})
	if err != nil {
		return u, err
	}
	if u.AvatarKey.Valid && u.AvatarKey.String != "" {
		deleteAvatarObject(ctx, store, u.AvatarKey.String)
	}
	return updated, nil
}

// deleteAvatarObject removes an orphaned avatar object; failures only leak
// storage, so they are logged rather than surfaced.
func deleteAvatarObject(ctx context.Context, store AvatarStorage, key string) {
	if err := store.Delete(ctx, key); err != nil {
		log.Printf("delete avatar object %s: %v", key, err)
	}
}
