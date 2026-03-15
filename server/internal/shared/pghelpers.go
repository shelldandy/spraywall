package shared

import (
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

// PgUUID converts a google/uuid.UUID to pgtype.UUID.
func PgUUID(id uuid.UUID) pgtype.UUID {
	return pgtype.UUID{Bytes: id, Valid: true}
}

// UUIDFromPg converts a pgtype.UUID to google/uuid.UUID.
func UUIDFromPg(id pgtype.UUID) uuid.UUID {
	return uuid.UUID(id.Bytes)
}

// PgTimestamptz converts a time.Time to pgtype.Timestamptz.
func PgTimestamptz(t time.Time) pgtype.Timestamptz {
	return pgtype.Timestamptz{Time: t, Valid: true}
}
