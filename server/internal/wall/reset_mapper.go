package wall

import (
	"encoding/json"
	"fmt"

	"github.com/google/uuid"
)

// remapRouteHolds replaces mapped hold IDs while preserving order and role arrays.
func remapRouteHolds(ids []uuid.UUID, roles json.RawMessage, matches map[uuid.UUID]uuid.UUID) ([]uuid.UUID, json.RawMessage, bool, error) {
	mapped := make([]uuid.UUID, len(ids))
	for i, id := range ids {
		newID, ok := matches[id]
		if !ok {
			return nil, nil, false, nil
		}
		mapped[i] = newID
	}
	if len(roles) == 0 || string(roles) == "null" {
		return mapped, roles, true, nil
	}
	var roleMap map[string][]uuid.UUID
	if err := json.Unmarshal(roles, &roleMap); err != nil {
		return nil, nil, false, fmt.Errorf("decode route hold roles: %w", err)
	}
	for key, roleIDs := range roleMap {
		if roleIDs == nil {
			roleIDs = []uuid.UUID{}
			roleMap[key] = roleIDs
		}
		for i, id := range roleIDs {
			newID, ok := matches[id]
			if !ok {
				return nil, nil, false, nil
			}
			roleMap[key][i] = newID
		}
	}
	encoded, err := json.Marshal(roleMap)
	return mapped, encoded, true, err
}
