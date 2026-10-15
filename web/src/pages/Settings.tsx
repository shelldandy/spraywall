import styles from "./Settings.module.css";
import { useGoBack } from "../lib/nav";

const APP_VERSION = __APP_VERSION__;

export default function SettingsPage() {

  const goBack = useGoBack("/walls");

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
