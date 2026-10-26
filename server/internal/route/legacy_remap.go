package route

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/bowlinedandy/spraywall/server/db/generated"
)

// remapToActive translates a route's holds through each partial-reset image
// between its original image and the wall's active image. Holds without a
// match are dropped rather than making the entire route uneditable.
func remapToActive(ctx context.Context, db generated.DBTX, routeImageID, activeImageID uuid.UUID, holdIDs []uuid.UUID, roles json.RawMessage) ([]uuid.UUID, json.RawMessage, error) {
	if db == nil {
		return nil, nil, errors.New("database unavailable")
	}
	if routeImageID == activeImageID {
		return append([]uuid.UUID{}, holdIDs...), roles, nil
	}

	// Walk from the active image toward its parents, recording each child
	// image whose matches translate from its parent.
	chain := make([]uuid.UUID, 0)
	seen := map[uuid.UUID]bool{activeImageID: true}
	current := activeImageID
	for current != routeImageID {
		var parent pgtype.UUID
		err := db.QueryRow(ctx, `SELECT parent_image_id FROM wall_images WHERE id=$1`, current).Scan(&parent)
		if errors.Is(err, pgx.ErrNoRows) || (err == nil && !parent.Valid) {
			return []uuid.UUID{}, nil, nil
		}
		if err != nil {
			return nil, nil, fmt.Errorf("load wall image ancestry: %w", err)
		}
		parentID := uuid.UUID(parent.Bytes)
		if seen[parentID] {
			return []uuid.UUID{}, nil, nil
		}
		seen[parentID] = true
		chain = append(chain, current)
		current = parentID
	}

	mappedIDs := append([]uuid.UUID{}, holdIDs...)
	mappedRoles := roles
	for i := len(chain) - 1; i >= 0; i-- {
		matches := make(map[uuid.UUID]uuid.UUID)
		rows, err := db.Query(ctx, `SELECT old_hold_id,new_hold_id FROM hold_matches WHERE wall_image_id=$1`, chain[i])
		if err != nil {
			return nil, nil, fmt.Errorf("load hold matches: %w", err)
		}
		for rows.Next() {
			var oldID, newID uuid.UUID
			if err := rows.Scan(&oldID, &newID); err != nil {
				rows.Close()
				return nil, nil, fmt.Errorf("read hold match: %w", err)
			}
			matches[oldID] = newID
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return nil, nil, fmt.Errorf("read hold matches: %w", err)
		}
		rows.Close()

		mappedIDs, mappedRoles, err = remapPartialHolds(mappedIDs, mappedRoles, matches)
		if err != nil {
			return nil, nil, err
		}
	}
	return mappedIDs, mappedRoles, nil
}

func uuidIDsFromPg(ids []pgtype.UUID) []uuid.UUID {
	result := make([]uuid.UUID, len(ids))
	for i, id := range ids {
		result[i] = uuid.UUID(id.Bytes)
	}
	return result
}

func remapPartialHolds(ids []uuid.UUID, roles json.RawMessage, matches map[uuid.UUID]uuid.UUID) ([]uuid.UUID, json.RawMessage, error) {
	mappedIDs := make([]uuid.UUID, 0, len(ids))
	for _, id := range ids {
		if newID, ok := matches[id]; ok {
			mappedIDs = append(mappedIDs, newID)
		}
	}
	if len(roles) == 0 || string(roles) == "null" {
		return mappedIDs, roles, nil
	}

	var roleMap map[string][]uuid.UUID
	if err := json.Unmarshal(roles, &roleMap); err != nil {
		return nil, nil, fmt.Errorf("decode route hold roles: %w", err)
	}
	for key, roleIDs := range roleMap {
		mappedRoleIDs := make([]uuid.UUID, 0, len(roleIDs))
		for _, id := range roleIDs {
			if newID, ok := matches[id]; ok {
				mappedRoleIDs = append(mappedRoleIDs, newID)
			}
		}
		roleMap[key] = mappedRoleIDs
	}
	encoded, err := json.Marshal(roleMap)
	return mappedIDs, encoded, err
}
