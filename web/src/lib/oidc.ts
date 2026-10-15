import { API_BASE } from "./api/fetch";

// Error codes the server's OIDC callback puts in `?error=` (on /login or /profile).
const OIDC_ERRORS: Record<string, string> = {
  oidc_failed: "Single sign-on failed. Please try again.",
  state_invalid: "Your sign-in session expired. Please try again.",
  email_missing: "Your account provider didn't share an email address.",
  email_unverified: "Your email address isn't verified with your account provider.",
  identity_in_use: "That account is already linked to another user.",
  access_denied: "Sign-in was cancelled or access was denied.",
};

export function oidcErrorMessage(code: string): string {
  return OIDC_ERRORS[code] ?? "Something went wrong signing in. Please try again.";
}

/** Only same-origin paths; "//host" and "/\host" are protocol-relative to browsers. */
export function safeRedirect(path: string | null | undefined, fallback = "/walls"): string {
  if (!path || !path.startsWith("/") || path.startsWith("//") || path.startsWith("/\\")) {
    return fallback;
  }
  return path;
}

/** Full-page navigation target for "Sign in with …"; the server bounces back to /auth/callback. */
export function oidcLoginUrl(redirect: string): string {
  return `${API_BASE}/auth/oidc/login?redirect=${encodeURIComponent(redirect)}`;
}
