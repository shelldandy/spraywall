package route

import (
	"bytes"
	"encoding/json"
	"fmt"
)

var routeTagCatalog = []string{
	"pumpy",
	"crimpy",
	"pinchy",
	"slopey",
	"juggy",
	"powerful",
	"technical",
	"balancy",
	"dynamic",
	"static",
	"reachy",
	"compression",
}

var routeTagOrder = func() map[string]int {
	order := make(map[string]int, len(routeTagCatalog))
	for i, tag := range routeTagCatalog {
		order[tag] = i
	}
	return order
}()

// normalizeRouteTags validates tag IDs, removes duplicates, and returns catalog order.
func normalizeRouteTags(tags []string) ([]string, error) {
	seen := make(map[string]bool, len(tags))
	normalized := make([]string, 0, len(tags))
	for _, tag := range tags {
		if _, ok := routeTagOrder[tag]; !ok {
			return nil, fmt.Errorf("unknown route tag %q", tag)
		}
		if !seen[tag] {
			seen[tag] = true
			normalized = append(normalized, tag)
		}
	}
	// Input is small; sorting against catalog rank preserves the contract order.
	for i := 1; i < len(normalized); i++ {
		for j := i; j > 0 && routeTagOrder[normalized[j]] < routeTagOrder[normalized[j-1]]; j-- {
			normalized[j], normalized[j-1] = normalized[j-1], normalized[j]
		}
	}
	return normalized, nil
}

// decodeRouteTags treats omitted/null values as unspecified and requires other values to be string arrays.
func decodeRouteTags(raw json.RawMessage) (tags []string, specified bool, err error) {
	if len(raw) == 0 || bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
		return nil, false, nil
	}
	if err := json.Unmarshal(raw, &tags); err != nil || tags == nil {
		return nil, true, fmt.Errorf("tags must be an array of strings")
	}
	normalized, err := normalizeRouteTags(tags)
	if err != nil {
		return nil, true, err
	}
	return normalized, true, nil
}

func nonNilRouteTags(tags []string) []string {
	if tags == nil {
		return []string{}
	}
	return tags
}
