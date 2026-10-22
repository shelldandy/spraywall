import { useState, type FormEvent } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router";
import { API_BASE } from "../lib/api/fetch";
import { useAuthConfig } from "../lib/hooks/queries";
import { useAuthStore } from "../lib/store/auth";
import styles from "./Auth.module.css";

export default function RegisterPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from;
  const accessToken = useAuthStore((s) => s.accessToken);
  const setTokens = useAuthStore((s) => s.setTokens);
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const configQuery = useAuthConfig();

  if (accessToken) {
    return <Navigate to={from ?? "/walls"} replace />;
  }

  if (configQuery.isPending) {
    return (
      <main className="center">
        <div className="spinner" />
      </main>
    );
  }

  // Accounts come from the identity provider only; the login page offers SSO.
  if (configQuery.data?.password_enabled === false) {
    return <Navigate to="/login" replace state={location.state} />;
  }

  const handleRegister = async (e: FormEvent) => {
    e.preventDefault();
    if (!displayName || !email || !password) {
      setError("Please fill in all fields.");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password,
          display_name: displayName,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error ?? `Registration failed (${res.status}).`);
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
      <p className={styles.subtitle}>Create Account</p>
      <form className={styles.form} onSubmit={handleRegister} noValidate>
        <input
          className="input"
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="Display Name"
          autoComplete="name"
          autoCorrect="off"
          enterKeyHint="next"
        />
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
          autoComplete="new-password"
          enterKeyHint="go"
        />
        {error && <p className={`error-text ${styles.error}`}>{error}</p>}
        <button type="submit" className={`btn btn-primary ${styles.submit}`} disabled={loading}>
          {loading ? "Registering..." : "Register"}
        </button>
      </form>
      <Link to="/login" state={location.state} className={styles.link}>
        Already have an account? Log In
      </Link>
    </main>
  );
}
