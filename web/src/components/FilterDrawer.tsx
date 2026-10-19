import { useEffect, useId, useRef, type ReactNode, type RefObject } from "react";
import styles from "./FilterDrawer.module.css";

interface FilterDrawerProps {
  open: boolean;
  title: string;
  onClose: () => void;
  onClear: () => void;
  matchingCount: number;
  countLabel?: string;
  triggerRef: RefObject<HTMLButtonElement | null>;
  children: ReactNode;
}

/** Shared accessible native-dialog shell for route filters. */
export default function FilterDrawer({ open, title, onClose, onClear, matchingCount, countLabel, triggerRef, children }: FilterDrawerProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = `filter-title-${useId().replaceAll(":", "")}`;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      className={styles.overlay}
      aria-labelledby={titleId}
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
      onClose={() => { onClose(); triggerRef.current?.focus(); }}
    >
      <section className={styles.sheet}>
        <header className={styles.header}>
          <h2 id={titleId} className={styles.title}>{title}</h2>
          <button type="button" autoFocus className="btn btn-ghost" onClick={onClose}>Done</button>
        </header>
        <div className={styles.content}>{children}</div>
        <footer className={styles.footer}>
          <button type="button" className="btn btn-ghost" onClick={onClear}>Clear</button>
          <span className={styles.count} aria-live="polite">{countLabel ?? `${matchingCount} matching route${matchingCount === 1 ? "" : "s"}`}</span>
        </footer>
      </section>
    </dialog>
  );
}
