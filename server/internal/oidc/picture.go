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
	trustedHost := ""
	if u, err := url.Parse(issuerURL); err == nil {
		trustedHost = u.Hostname()
	}
	dialer := &net.Dialer{Timeout: 5 * time.Second}

	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.Proxy = nil
	transport.DialContext = func(ctx context.Context, network, addr string) (net.Conn, error) {
		host, port, err := net.SplitHostPort(addr)
		if err != nil {
			return nil, err
		}
		if trustedHost != "" && strings.EqualFold(host, trustedHost) {
			return dialer.DialContext(ctx, network, addr)
		}
		ips, err := net.DefaultResolver.LookupNetIP(ctx, "ip", host)
		if err != nil {
			return nil, err
		}
		for _, ip := range ips {
			if !isPublicAddr(ip) {
				return nil, fmt.Errorf("picture host %s resolves to non-public address %s", host, ip)
			}
		}
		if len(ips) == 0 {
			return nil, fmt.Errorf("picture host %s has no addresses", host)
		}
		// Dial the checked address so a second lookup can't swap it.
		return dialer.DialContext(ctx, network, net.JoinHostPort(ips[0].String(), port))
	}

	return &http.Client{Timeout: pictureTimeout, Transport: transport}
}

// isPublicAddr rejects loopback, private, link-local (incl. cloud metadata),
// CGNAT, multicast, and unspecified addresses.
func isPublicAddr(ip netip.Addr) bool {
	ip = ip.Unmap()
	if ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() ||
		ip.IsInterfaceLocalMulticast() || ip.IsMulticast() || ip.IsUnspecified() {
		return false
	}
	return !cgnat.Contains(ip)
}

var cgnat = netip.MustParsePrefix("100.64.0.0/10")
