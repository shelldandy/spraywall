package route

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const immichDisabledMessage = "Immich links aren't enabled on this server"

const immichPasswordProtectedMessage = "Immich share is password-protected or unavailable"

var errImmichUpstream = errors.New("immich server is unavailable")
var errImmichDisabled = errors.New("immich links are disabled")
var errImmichPasswordProtected = errors.New("immich share is password-protected or unavailable")

type ImmichClient struct {
	allowedHosts map[string]struct{}
	httpClient   *http.Client
}

// NewImmichClient configures Immich share access. Host matching is exact,
// including an optional port, so submitted links cannot target arbitrary hosts.
func NewImmichClient(hosts []string) *ImmichClient {
	allowed := make(map[string]struct{}, len(hosts))
	for _, host := range hosts {
		host = normalizeHost(strings.TrimSpace(host))
		if host != "" {
			allowed[host] = struct{}{}
		}
	}
	return &ImmichClient{
		allowedHosts: allowed,
		httpClient: &http.Client{
			Timeout: 20 * time.Second,
			CheckRedirect: func(req *http.Request, via []*http.Request) error {
				if len(via) > 0 && !strings.EqualFold(req.URL.Host, via[len(via)-1].URL.Host) {
					return http.ErrUseLastResponse
				}
				return nil
			},
		},
	}
}

func (c *ImmichClient) hasAllowedHosts() bool {
	return c != nil && len(c.allowedHosts) > 0
}

func (c *ImmichClient) allowsHost(host string) bool {
	if c == nil {
		return false
	}
	_, ok := c.allowedHosts[normalizeHost(host)]
	return ok
}

func (c *ImmichClient) allowedHostList() []string {
	if c == nil {
		return nil
	}
	result := make([]string, 0, len(c.allowedHosts))
	for host := range c.allowedHosts {
		result = append(result, host)
	}
	return result
}

func normalizeHost(host string) string {
	host = strings.ToLower(strings.TrimSuffix(host, "."))
	return host
}

type immichAsset struct {
	ID   string `json:"id"`
	Type string `json:"type"`
}

type immichShare struct {
	Key    string        `json:"key"`
	Assets []immichAsset `json:"assets"`
	Album  struct {
		Assets []immichAsset `json:"assets"`
	} `json:"album"`
}

func (c *ImmichClient) resolveVideo(ctx context.Context, ref *immichRef) (string, string, error) {
	if !c.hasAllowedHosts() {
		return "", "", errImmichDisabled
	}
	if !c.allowsHost(hostFromBaseURL(ref.baseURL)) {
		return "", "", errImmichHostNotAllowed
	}
	endpoint, err := url.Parse(strings.TrimRight(ref.baseURL, "/") + "/api/shared-links/me")
	if err != nil {
		return "", "", err
	}
	query := endpoint.Query()
	if ref.shareKey != "" {
		query.Set("key", ref.shareKey)
	} else {
		query.Set("slug", ref.shareSlug)
	}
	endpoint.RawQuery = query.Encode()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint.String(), nil)
	if err != nil {
		return "", "", err
	}
	response, err := c.httpClient.Do(request)
	if err != nil {
		return "", "", fmt.Errorf("%w: %v", errImmichUpstream, err)
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode == http.StatusUnauthorized || response.StatusCode == http.StatusForbidden {
		return "", "", errImmichPasswordProtected
	}
	if response.StatusCode != http.StatusOK {
		if response.StatusCode >= http.StatusInternalServerError || response.StatusCode >= 300 && response.StatusCode < 400 {
			return "", "", fmt.Errorf("%w (status %d)", errImmichUpstream, response.StatusCode)
		}
		return "", "", fmt.Errorf("immich share returned status %d", response.StatusCode)
	}
	var share immichShare
	if err := json.NewDecoder(io.LimitReader(response.Body, 4<<20)).Decode(&share); err != nil {
		return "", "", fmt.Errorf("%w: decode share response: %v", errImmichUpstream, err)
	}
	for _, assets := range [][]immichAsset{share.Assets, share.Album.Assets} {
		for _, asset := range assets {
			if strings.EqualFold(asset.Type, "VIDEO") && asset.ID != "" {
				return asset.ID, share.Key, nil
			}
		}
	}
	return "", "", errors.New("immich share doesn't contain a video")
}

func hostFromBaseURL(base string) string {
	parsed, err := url.Parse(base)
	if err != nil {
		return ""
	}
	return parsed.Host
}

func (c *ImmichClient) mediaRequest(ctx context.Context, baseURL, path string, shareKey, shareSlug string, headers http.Header) (*http.Response, error) {
	if !c.allowsHost(hostFromBaseURL(baseURL)) {
		return nil, errors.New("immich host isn't allowed")
	}
	endpoint, err := url.Parse(strings.TrimRight(baseURL, "/") + path)
	if err != nil {
		return nil, err
	}
	query := endpoint.Query()
	if shareKey != "" {
		query.Set("key", shareKey)
	} else if shareSlug != "" {
		query.Set("slug", shareSlug)
	}
	endpoint.RawQuery = query.Encode()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint.String(), nil)
	if err != nil {
		return nil, err
	}
	for _, name := range []string{"Range", "If-Range"} {
		if value := headers.Get(name); value != "" {
			request.Header.Set(name, value)
		}
	}
	return c.httpClient.Do(request)
}
