import { useEffect, useId, useRef, type AnimationEvent, type ReactNode, type RefObject } from "react";
import styles from "./FilterDrawer.module.css";

interface FilterDrawerProps {
  open: boolean;
  title: string;
  onClose: () => void;
  onBack?: () => void;
  onClear?: () => void;
  matchingCount?: number;
  countLabel?: string;
  showFooter?: boolean;
  triggerRef: RefObject<HTMLButtonElement | null>;
  children: ReactNode;
}

/** Shared accessible native-dialog shell for route filters and detail panels. */
export default function FilterDrawer({ open, title, onClose, onBack, onClear, matchingCount, countLabel, showFooter = true, triggerRef, children }: FilterDrawerProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = `filter-title-${useId().replaceAll(":", "")}`;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open) {
      if (!dialog.open) {
        dialog.showModal();
        // Keep the modal itself focused so its offscreen opening animation doesn't scroll the dialog.
        dialog.focus({ preventScroll: true });
        dialog.scrollTop = 0;
      }
      dialog.firstElementChild?.classList.remove(styles.sheetClosing);
    } else if (dialog.open) dialog.firstElementChild?.classList.add(styles.sheetClosing);
  }, [open]);

  const requestClose = () => dialogRef.current?.firstElementChild?.classList.add(styles.sheetClosing);
  const finishClose = (event: AnimationEvent<HTMLElement>) => {
    if (event.target === event.currentTarget && event.currentTarget.classList.contains(styles.sheetClosing)) {
      dialogRef.current?.close();
    }
  };

  return (
    <dialog
      ref={dialogRef}
      className={styles.overlay}
      aria-labelledby={titleId}
      tabIndex={-1}
      onClick={(event) => { if (event.target === event.currentTarget) requestClose(); }}
      onCancel={(event) => { event.preventDefault(); requestClose(); }}
      onClose={() => {
        dialogRef.current?.firstElementChild?.classList.remove(styles.sheetClosing);
        onClose();
        triggerRef.current?.focus();
      }}
    >
      <section className={styles.sheet} onAnimationEnd={finishClose}>
        <header className={styles.header}>
          {onBack && <button type="button" className="btn btn-ghost" onClick={onBack} aria-label="Back">‹</button>}
          <h2 id={titleId} className={styles.title}>{title}</h2>
          <button type="button" className="btn btn-ghost" onClick={requestClose}>Done</button>
        </header>
        <div className={styles.content}>{children}</div>
        {showFooter && onClear && matchingCount !== undefined && (
          <footer className={styles.footer}>
            <button type="button" className="btn btn-ghost" onClick={onClear}>Clear</button>
            <span className={styles.count} aria-live="polite">{countLabel ?? `${matchingCount} matching route${matchingCount === 1 ? "" : "s"}`}</span>
          </footer>
        )}
      </section>
    </dialog>
  );
}
