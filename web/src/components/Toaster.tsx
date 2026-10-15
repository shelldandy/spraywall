import { useToastStore } from "../lib/toast";
import styles from "./Toaster.module.css";

export default function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  return (
    <div className={styles.stack} role="status" aria-live="polite">
      {toasts.map((t) => (
        <button
          key={t.id}
          className={`${styles.toast} ${t.kind === "error" ? styles.error : ""}`}
          onClick={() => dismiss(t.id)}
        >
          {t.message}
        </button>
      ))}
    </div>
  );
}
