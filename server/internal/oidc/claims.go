package oidc

import (
	"slices"
	"strings"

	"github.com/bowlinedandy/spraywall/server/db/generated"
)

// identityClaims are the claims spraywall uses from the ID token, optionally
// completed from the UserInfo endpoint.
type identityClaims struct {
	Email             string
	EmailVerified     bool
	Name              string
	PreferredUsername string
	Picture           string
	Groups            []string
	hasEmail          bool
	hasGroups         bool
}

func stringClaim(m map[string]any, key string) string {
	s, _ := m[key].(string)
	return strings.TrimSpace(s)
}

// parseClaims extracts identity claims from a decoded claim set.
func parseClaims(m map[string]any, groupsClaim string) identityClaims {
	var c identityClaims
	c.merge(m, groupsClaim)
	return c
}

// merge fills in claims that are still missing from m (used to complete ID
// token claims with UserInfo).
func (c *identityClaims) merge(m map[string]any, groupsClaim string) {
	if !c.hasEmail {
		if email := stringClaim(m, "email"); email != "" {
			c.Email = email
			c.EmailVerified = parseBoolClaim(m["email_verified"])
			c.hasEmail = true
		}
	} else if !c.EmailVerified && strings.EqualFold(stringClaim(m, "email"), c.Email) {
		// The ID token may carry email without email_verified while UserInfo
		// has both.
		c.EmailVerified = parseBoolClaim(m["email_verified"])
	}
	if c.Name == "" {
		c.Name = stringClaim(m, "name")
	}
	if c.PreferredUsername == "" {
		c.PreferredUsername = stringClaim(m, "preferred_username")
	}
	if c.Picture == "" {
		c.Picture = stringClaim(m, "picture")
	}
	if !c.hasGroups {
		c.Groups, c.hasGroups = parseGroups(m[groupsClaim])
	}
}

// parseBoolClaim accepts a JSON boolean or the string "true" (some IdPs
// serialize email_verified as a string).
func parseBoolClaim(v any) bool {
	switch b := v.(type) {
	case bool:
		return b
	case string:
		return strings.EqualFold(strings.TrimSpace(b), "true")
	}
	return false
}

// parseGroups accepts a list of strings or a single string. ok reports
// whether the claim was present at all.
func parseGroups(v any) (groups []string, ok bool) {
	switch g := v.(type) {
	case []any:
		groups = make([]string, 0, len(g))
		for _, item := range g {
			if s, isStr := item.(string); isStr {
				groups = append(groups, s)
			}
		}
		return groups, true
	case []string:
		return g, true
	case string:
		if g == "" {
			return []string{}, true
		}
		return []string{g}, true
	}
	return nil, false
}

// roleForGroups maps group membership to an instance role.
func roleForGroups(groups []string, adminGroup string) generated.UserRole {
	if slices.Contains(groups, adminGroup) {
		return generated.UserRoleAdmin
	}
	return generated.UserRoleClimber
}

// displayName picks name, then preferred_username, then the email local part.
func (c identityClaims) displayName() string {
	if c.Name != "" {
		return c.Name
	}
	if c.PreferredUsername != "" {
		return c.PreferredUsername
	}
	local, _, _ := strings.Cut(c.Email, "@")
	return local
}
