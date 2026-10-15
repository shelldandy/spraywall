import { useNavigate } from "react-router";
import styles from "./Settings.module.css";

// The Expo app read this from app.json; the web build has no injected version yet.
const APP_VERSION = "1.0.0";

export default function SettingsPage() {
  const navigate = useNavigate();

  const goBack = () => {
    // react-router stores the history index in history.state; idx 0 means we were opened directly.
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) navigate(-1);
    else navigate("/walls", { replace: true });
  };

  return (
    <div className={`screen ${styles.page}`}>
      <main className={styles.container}>
        <h1 className={styles.title}>Settings</h1>

        <section className={styles.section}>
          <h2 className={styles.label}>App Version</h2>
          <p className={styles.value}>{APP_VERSION}</p>
        </section>

        <button type="button" className={`btn btn-primary ${styles.back}`} onClick={goBack}>
          Back
        </button>
      </main>
    </div>
  );
}
