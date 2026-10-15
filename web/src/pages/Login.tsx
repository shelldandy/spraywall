import { useState, type FormEvent } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router";
import { API_BASE } from "../lib/api/fetch";
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

  return (
    <main className="center">
      <h1 className={styles.title}>Spraywall</h1>
      <p className={styles.subtitle}>Log In</p>
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
        {error && <p className={`error-text ${styles.error}`}>{error}</p>}
        <button type="submit" className={`btn btn-primary ${styles.submit}`} disabled={loading}>
          {loading ? "Logging in..." : "Log In"}
        </button>
      </form>
      <Link to="/register" state={location.state} className={styles.link}>
        Don&apos;t have an account? Register
      </Link>
    </main>
  );
}
