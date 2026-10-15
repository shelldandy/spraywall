import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "../lib/api/fetch";
import { toast } from "../lib/toast";
import styles from "./Invite.module.css";

interface InviteInfo {
  gym_name: string;
  gym_slug: string;
  role: string;
  expires_at: string;
}

export default function InvitePage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [invite, setInvite] = useState<InviteInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const fetchInvite = async () => {
      try {
        const res = await apiFetch(`/invites/${token}`);
        if (cancelled) return;
        if (!res.ok) {
          const data = await res.json().catch(() => null);
          if (!cancelled) setError(data?.error || "Invite not found or expired");
          return;
        }
        const data: InviteInfo = await res.json();
        if (!cancelled) setInvite(data);
      } catch {
        if (!cancelled) setError("Failed to load invite");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchInvite();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const handleAccept = async () => {
    if (!token) return;
    setAccepting(true);
    setError(null);

    try {
      const res = await apiFetch(`/invites/${token}/accept`, { method: "POST" });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        if (res.status === 409) {
          toast("You are already a member of this gym.");
        } else {
          setError(data?.error || "Failed to accept invite");
        }
        return;
      }

      queryClient.invalidateQueries({ queryKey: ["gyms-with-walls"] });
      queryClient.invalidateQueries({ queryKey: ["gyms"] });
      toast(`You have joined ${invite?.gym_name}.`);
      navigate("/walls", { replace: true });
    } catch {
      setError("Failed to accept invite");
    } finally {
      setAccepting(false);
    }
  };

  if (loading) {
    return (
      <main className="center">
        <div className="spinner" />
        <p className={styles.loadingText}>Loading invite...</p>
      </main>
    );
  }

  if (error && !invite) {
    return (
      <main className="center">
        <p className={`error-text ${styles.errorText}`}>{error}</p>
        <button
          type="button"
          className={`btn btn-primary btn-block ${styles.button}`}
          onClick={() => navigate("/walls", { replace: true })}
        >
          Go Back
        </button>
      </main>
    );
  }

  if (!invite) return null;

  return (
    <main className={`center ${styles.container}`}>
      <h1 className={styles.title}>You&apos;ve been invited!</h1>

      <div className={styles.card}>
        <h2 className={styles.gymName}>{invite.gym_name}</h2>
        <p className={styles.roleLabel}>
          Role: <span className={styles.roleValue}>{invite.role}</span>
        </p>
        <p className={styles.expiry}>
          Expires: {new Date(invite.expires_at).toLocaleDateString()}
        </p>
      </div>

      {error && <p className={`error-text ${styles.errorText}`}>{error}</p>}

      <button
        type="button"
        className={`btn btn-primary btn-block ${styles.button}`}
        onClick={handleAccept}
        disabled={accepting}
      >
        {accepting ? <span className={`spinner ${styles.buttonSpinner}`} /> : "Join Gym"}
      </button>
    </main>
  );
}
