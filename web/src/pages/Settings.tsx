import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { useMutation } from "@tanstack/react-query";
import { apiFetch } from "../lib/api/fetch";
import { useMe } from "../lib/hooks/queries";
import { logout } from "../lib/queryClient";
import { toast } from "../lib/toast";
import styles from "./Settings.module.css";

const APP_VERSION = __APP_VERSION__;

type InviteRole = "climber" | "setter" | "admin";

export default function SettingsPage() {
  const navigate = useNavigate();
  const profile = useMe();
  const [role, setRole] = useState<InviteRole>("climber");
  const [inviteLink, setInviteLink] = useState("");
  const handleLogout = async () => {
    await logout();
    navigate("/login", { replace: true });
  };
  const createInvite = useMutation<string, Error, InviteRole>({
    mutationFn: async (inviteRole) => {
      const response = await apiFetch("/invites", {
        method: "POST",
        body: JSON.stringify({ role: inviteRole }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || "Failed to create invite");
      }
      const data: { token: string } = await response.json();
      return `${window.location.origin}/invite/${data.token}`;
    },
    onSuccess: setInviteLink,
    onError: (error) => toast(error.message, "error"),
  });

  const copyInvite = async () => {
    try {
      await navigator.clipboard.writeText(inviteLink);
      toast("Invite link copied to clipboard.");
    } catch {
      toast(`Could not copy the invite link: ${inviteLink}`, "error");
    }
  };

  return (
    <div className={`screen ${styles.page}`}>
      <main className={styles.container}>
        <h1 className={styles.title}>Settings</h1>

        <section className={styles.section}>
          <h2 className={styles.label}>Account</h2>
          <Link to="/profile" className={styles.navRow}>
            <span>Profile</span>
            <span className={styles.chevron} aria-hidden="true">&rsaquo;</span>
          </Link>
        </section>

        {profile.data?.role === "admin" && (
          <section className={styles.section}>
            <h2 className={styles.label}>Invite people</h2>
            <label className={styles.inviteRole}>
              Role
              <select className="input" value={role} onChange={(event) => { setRole(event.target.value as InviteRole); setInviteLink(""); }}>
                <option value="climber">Climber</option>
                <option value="setter">Setter</option>
                <option value="admin">Admin</option>
              </select>
            </label>
            <button type="button" className="btn btn-primary" onClick={() => createInvite.mutate(role)} disabled={createInvite.isPending}>
              {createInvite.isPending ? "Creating..." : "Create invite link"}
            </button>
            {inviteLink && <div className={styles.inviteLink}>
              <input className="input" value={inviteLink} readOnly aria-label="Invite link" />
              <button type="button" className="btn btn-ghost" onClick={() => void copyInvite()}>Copy link</button>
            </div>}
          </section>
        )}

        <section className={styles.section}>
          <h2 className={styles.label}>App Version</h2>
          <p className={styles.value}>{APP_VERSION}</p>
        </section>

        <button type="button" className="btn btn-danger" onClick={handleLogout}>Logout</button>
      </main>
    </div>
  );
}
