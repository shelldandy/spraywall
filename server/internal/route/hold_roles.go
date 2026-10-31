package route

import (
	"bytes"
	"encoding/json"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/bowlinedandy/spraywall/server/internal/shared"
)

func validateHoldRoles(raw *json.RawMessage, holdIDs []pgtype.UUID) error {
	if raw == nil || bytes.Equal(bytes.TrimSpace(*raw), []byte("null")) {
		return nil
	}

	var roles map[string]json.RawMessage
	if err := json.Unmarshal(*raw, &roles); err != nil || roles == nil {
		return fmt.Errorf("hold_roles must be an object")
	}
	validHolds := make(map[pgtype.UUID]struct{}, len(holdIDs))
	for _, id := range holdIDs {
		validHolds[id] = struct{}{}
	}
	assigned := make(map[pgtype.UUID]string)
	for role, value := range roles {
		if role != "start" && role != "finish" && role != "foot" {
			return fmt.Errorf("unknown hold role %q", role)
		}
		var ids []string
		if err := json.Unmarshal(value, &ids); err != nil || ids == nil {
			return fmt.Errorf("hold role %q must be an array of hold IDs", role)
		}
		for _, id := range ids {
			parsed, err := uuid.Parse(id)
			if err != nil {
				return fmt.Errorf("invalid hold ID in role %q", role)
			}
			pgID := shared.PgUUID(parsed)
			if _, ok := validHolds[pgID]; !ok {
				return fmt.Errorf("hold role %q references a hold not included in hold_ids", role)
			}
			if previous, ok := assigned[pgID]; ok {
				return fmt.Errorf("hold cannot have both %q and %q roles", previous, role)
			}
			assigned[pgID] = role
		}
	}
	return nil
}
