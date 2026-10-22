import { Link, useNavigate } from "react-router";
import { logout } from "../lib/queryClient";
import styles from "./Settings.module.css";

const APP_VERSION = __APP_VERSION__;

export default function SettingsPage() {
  const navigate = useNavigate();
  const handleLogout = async () => {
    await logout();
    navigate("/login", { replace: true });
  };

  return (
    <div className={`screen ${styles.page}`}>
      <main className={styles.container}>
        <h1 className={styles.title}>Settings</h1>

        <section className={styles.section}>
          <h2 className={styles.label}>Account</h2>
          <Link to="/profile" className={styles.navRow}>
            <span>Profile</span>
            <span className={styles.chevron} aria-hidden="true">
              &rsaquo;
            </span>
          </Link>
        </section>

        <section className={styles.section}>
          <h2 className={styles.label}>App Version</h2>
          <p className={styles.value}>{APP_VERSION}</p>
        </section>

        <button type="button" className="btn btn-ghost" onClick={handleLogout}>
          Logout
        </button>
      </main>
    </div>
  );
}
