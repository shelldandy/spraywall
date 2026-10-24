package wall

import (
	"encoding/json"
	"testing"

	"github.com/google/uuid"
)

func TestRemapRouteHoldsMapsIDsAndRoles(t *testing.T) {
	oldA, oldB := uuid.New(), uuid.New()
	newA, newB := uuid.New(), uuid.New()
	ids, roles, kept, err := remapRouteHolds([]uuid.UUID{oldA, oldB}, json.RawMessage(`{"start":["`+oldA.String()+`"],"finish":["`+oldB.String()+`"],"foot":[]}`), map[uuid.UUID]uuid.UUID{oldA: newA, oldB: newB})
	if err != nil || !kept {
		t.Fatalf("remap: kept=%v err=%v", kept, err)
	}
	if ids[0] != newA || ids[1] != newB {
		t.Fatalf("mapped IDs = %v", ids)
	}
	var got map[string][]uuid.UUID
	if err := json.Unmarshal(roles, &got); err != nil {
		t.Fatal(err)
	}
	if got["start"][0] != newA || got["finish"][0] != newB || len(got["foot"]) != 0 {
		t.Fatalf("mapped roles = %s", roles)
	}
}

func TestRemapRouteHoldsLeavesIncompleteRouteUnmoved(t *testing.T) {
	old := uuid.New()
	_, _, kept, err := remapRouteHolds([]uuid.UUID{old, uuid.New()}, nil, map[uuid.UUID]uuid.UUID{old: uuid.New()})
	if err != nil || kept {
		t.Fatalf("kept=%v err=%v", kept, err)
	}
}
