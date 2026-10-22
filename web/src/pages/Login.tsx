import { useState, type FormEvent } from "react";
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from "react-router";
import { API_BASE } from "../lib/api/fetch";
import { useAuthConfig } from "../lib/hooks/queries";
import { oidcErrorMessage, oidcLoginUrl } from "../lib/oidc";
import { useAuthStore } from "../lib/store/auth";
import styles from "./Auth.module.css";

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from;
  const accessToken = useAuthStore((s) => s.accessToken);
  const setTokens = useAuthStore((s) => s.setTokens);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchParams] = useSearchParams();
  const ssoError = searchParams.get("error");
  const configQuery = useAuthConfig();

  if (accessToken) {
    return <Navigate to={from ?? "/walls"} replace />;
  }

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      setError("Please enter both email and password.");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error ?? `Login failed (${res.status}).`);
        return;
      }

      const data = await res.json();
      setTokens(data.access_token, data.refresh_token);
      navigate(from ?? "/walls", { replace: true });
    } catch {
      setError("Could not reach the server.");
    } finally {
      setLoading(false);
    }
  };

  // Hold the form back until we know which methods exist, so a password-less server
  // doesn't flash an email form. If the config can't be fetched, fall back to passwords.
  if (configQuery.isPending) {
    return (
      <main className="center">
        <div className="spinner" />
      </main>
    );
  }

  const passwordEnabled = configQuery.data?.password_enabled ?? true;
  const oidc = configQuery.data?.oidc.enabled ? configQuery.data.oidc : null;
  const shownError = error ?? (ssoError ? oidcErrorMessage(ssoError) : null);

  return (
    <main className="center">
      <img
        src="/logo-128.png"
        srcSet="/logo-256.png 2x"
        alt=""
        width={96}
        height={96}
        className={styles.logo}
      />
      <h1 className={styles.title}>Spraywall</h1>
      <p className={styles.subtitle}>Log In</p>
      {oidc && (
        <a
          href={oidcLoginUrl(from ?? "/walls")}
          className={`btn ${passwordEnabled ? "" : "btn-primary"} btn-block ${styles.sso}`}
        >
          Sign in with {oidc.name}
        </a>
      )}
      {oidc && passwordEnabled && <p className={styles.divider}>or</p>}
      {!passwordEnabled && shownError && (
        <p className={`error-text ${styles.error} ${styles.ssoError}`}>{shownError}</p>
      )}
      {!passwordEnabled && !oidc && (
        <p className={`error-text ${styles.error}`}>No login methods are enabled on this server.</p>
      )}
      {passwordEnabled && (
        <form className={styles.form} onSubmit={handleLogin} noValidate>
          <input
            className="input"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            autoComplete="email"
            autoCapitalize="none"
            autoCorrect="off"
            enterKeyHint="next"
          />
          <input
            className="input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            autoComplete="current-password"
            enterKeyHint="go"
          />
          {shownError && <p className={`error-text ${styles.error}`}>{shownError}</p>}
          <button type="submit" className={`btn btn-primary ${styles.submit}`} disabled={loading}>
            {loading ? "Logging in..." : "Log In"}
          </button>
        </form>
      )}
      {passwordEnabled && (
        <Link to="/register" state={location.state} className={styles.link}>
          Don&apos;t have an account? Register
        </Link>
      )}
    </main>
  );
}
