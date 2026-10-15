import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router";
import { safeRedirect } from "../lib/oidc";
import { useAuthStore } from "../lib/store/auth";

/**
 * Landing route after an IdP login. The server puts the tokens in the URL fragment
 * (never sent to servers or logged), we store them and replace the history entry so
 * the tokens don't linger in the address bar or back stack.
 */
export default function OidcCallbackPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const setTokens = useAuthStore((s) => s.setTokens);
  // StrictMode runs effects twice; the fragment must only be consumed once.
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;

    const params = new URLSearchParams(location.hash.replace(/^#/, ""));
    const accessToken = params.get("access_token");
    const refreshToken = params.get("refresh_token");

    if (!accessToken || !refreshToken) {
      navigate("/login?error=oidc_failed", { replace: true });
      return;
    }

    setTokens(accessToken, refreshToken);
    navigate(safeRedirect(params.get("redirect")), { replace: true });
  }, [location.hash, navigate, setTokens]);

  return (
    <main className="center">
      <div className="spinner" />
    </main>
  );
}
