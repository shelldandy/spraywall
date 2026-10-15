package oidc

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"strings"
	"time"
)

// newPictureClient returns an HTTP client for downloading profile pictures.
// The picture URL comes from IdP claims, which users can sometimes edit, so
// only the issuer's own host (often on a private network for self-hosted
// IdPs) may resolve to a non-public address. The check runs at dial time and
// therefore also covers redirects.
func newPictureClient(issuerURL string) *http.Client {
	trustedAddr := ""
	if u, err := url.Parse(issuerURL); err == nil && u.Hostname() != "" {
		port := u.Port()
		if port == "" {
			port = map[string]string{"http": "80", "https": "443"}[u.Scheme]
		}
		trustedAddr = net.JoinHostPort(strings.ToLower(u.Hostname()), port)
	}
	dialer := &net.Dialer{Timeout: 5 * time.Second}

	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.Proxy = nil
	transport.DialContext = func(ctx context.Context, network, addr string) (net.Conn, error) {
		host, port, err := net.SplitHostPort(addr)
		if err != nil {
			return nil, err
		}
		// Only the issuer's exact host and port may be private.
		if trustedAddr != "" && net.JoinHostPort(strings.ToLower(host), port) == trustedAddr {
			return dialer.DialContext(ctx, network, addr)
		}
		ips, err := net.DefaultResolver.LookupNetIP(ctx, "ip", host)
		if err != nil {
			return nil, err
		}
		if len(ips) == 0 {
			return nil, fmt.Errorf("picture host %s has no addresses", host)
		}
		for _, ip := range ips {
			if !isPublicAddr(ip) {
				return nil, fmt.Errorf("picture host %s resolves to non-public address %s", host, ip)
			}
		}
		// Dial the checked addresses so a second lookup can't swap them.
		var lastErr error
		for _, ip := range ips {
			conn, err := dialer.DialContext(ctx, network, net.JoinHostPort(ip.String(), port))
			if err == nil {
				return conn, nil
			}
			lastErr = err
		}
		return nil, lastErr
	}

	return &http.Client{Timeout: pictureTimeout, Transport: transport}
}

// isPublicAddr accepts only global unicast addresses outside private and
// special-purpose ranges (loopback, RFC 1918, link-local incl. cloud metadata,
// CGNAT, benchmarking, reserved, and IPv6 prefixes that embed IPv4).
func isPublicAddr(ip netip.Addr) bool {
	ip = ip.Unmap()
	if !ip.IsGlobalUnicast() || ip.IsPrivate() {
		return false
	}
	for _, p := range nonPublicPrefixes {
		if p.Contains(ip) {
			return false
		}
	}
	return true
}

var nonPublicPrefixes = []netip.Prefix{
	netip.MustParsePrefix("0.0.0.0/8"),
	netip.MustParsePrefix("100.64.0.0/10"),
	netip.MustParsePrefix("192.0.0.0/24"),
	netip.MustParsePrefix("198.18.0.0/15"),
	netip.MustParsePrefix("240.0.0.0/4"),
	netip.MustParsePrefix("64:ff9b::/96"),
	netip.MustParsePrefix("64:ff9b:1::/48"),
	netip.MustParsePrefix("2002::/16"),
	netip.MustParsePrefix("2001::/32"),
}
