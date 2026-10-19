package route

import (
	"encoding/json"
	"reflect"
	"testing"
)

func TestNormalizeRouteTags(t *testing.T) {
	catalog := []string{"pumpy", "crimpy", "pinchy", "slopey", "juggy", "powerful", "technical", "balancy", "dynamic", "static", "reachy", "compression"}
	tests := []struct {
		name    string
		input   []string
		want    []string
		wantErr bool
	}{
		{name: "catalog order", input: []string{"compression", "pumpy", "technical"}, want: []string{"pumpy", "technical", "compression"}},
		{name: "deduplicated", input: []string{"crimpy", "pumpy", "crimpy"}, want: []string{"pumpy", "crimpy"}},
		{name: "empty", input: []string{}, want: []string{}},
		{name: "nil", input: nil, want: []string{}},
		{name: "unknown", input: []string{"pumpy", "custom"}, wantErr: true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, err := normalizeRouteTags(test.input)
			if (err != nil) != test.wantErr {
				t.Fatalf("normalizeRouteTags error = %v, wantErr %v", err, test.wantErr)
			}
			if !test.wantErr && !reflect.DeepEqual(got, test.want) {
				t.Fatalf("normalizeRouteTags = %#v, want %#v", got, test.want)
			}
		})
	}
	if !reflect.DeepEqual(routeTagCatalog, catalog) {
		t.Fatalf("catalog = %#v, want %#v", routeTagCatalog, catalog)
	}
}

func TestDecodeRouteTags(t *testing.T) {
	tests := []struct {
		name      string
		raw       string
		specified bool
		want      []string
		wantErr   bool
	}{
		{name: "omitted", specified: false},
		{name: "null", raw: ` null `, specified: false},
		{name: "empty", raw: `[]`, specified: true, want: []string{}},
		{name: "canonicalize", raw: ` ["compression","pumpy","pumpy"] `, specified: true, want: []string{"pumpy", "compression"}},
		{name: "unknown", raw: `["custom"]`, specified: true, wantErr: true},
		{name: "number element", raw: `["pumpy",1]`, specified: true, wantErr: true},
		{name: "not array", raw: `"pumpy"`, specified: true, wantErr: true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, specified, err := decodeRouteTags(json.RawMessage(test.raw))
			if (err != nil) != test.wantErr {
				t.Fatalf("decodeRouteTags error = %v, wantErr %v", err, test.wantErr)
			}
			if specified != test.specified {
				t.Fatalf("specified = %v, want %v", specified, test.specified)
			}
			if !test.wantErr && !reflect.DeepEqual(got, test.want) {
				t.Fatalf("decodeRouteTags = %#v, want %#v", got, test.want)
			}
		})
	}
}
