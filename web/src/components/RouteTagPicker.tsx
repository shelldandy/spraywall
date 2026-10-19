import { useEffect, useRef, useState } from "react";
import { parseRouteTags, routeTags, type RouteTagId } from "../lib/routeTags";
import styles from "./RouteTagPicker.module.css";

interface RouteTagPickerProps {
  selectedTags: readonly RouteTagId[];
  onChange: (tags: RouteTagId[]) => void;
  label?: string;
  presentation?: "inline" | "dialog";
  compact?: boolean;
  helperText?: string;
  matchingCount?: number;
}

/** Multi-select route style tags inline or in the GradePicker-style dialog. */
export default function RouteTagPicker({
  selectedTags,
  onChange,
  label = "Style tags",
  presentation = "dialog",
  compact = false,
  helperText,
  matchingCount,
}: RouteTagPickerProps) {
  const [visible, setVisible] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const selected = parseRouteTags(selectedTags);
  const selectedSet = new Set(selected);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (visible && !dialog.open) dialog.showModal();
    else if (!visible && dialog.open) dialog.close();
  }, [visible]);

  const toggle = (tagId: RouteTagId) => {
    onChange(selectedSet.has(tagId)
      ? selected.filter((tag) => tag !== tagId)
      : routeTags.filter(({ id }) => selectedSet.has(id) || id === tagId).map(({ id }) => id));
  };

  const chips = (
    <div className={styles.chips} role="group" aria-label={label}>
      {routeTags.map(({ id, label: tagLabel }) => {
        const isSelected = selectedSet.has(id);
        return (
          <button
            key={id}
            type="button"
            className={`${styles.chip} ${isSelected ? styles.chipSelected : ""}`}
            aria-pressed={isSelected}
            onClick={() => toggle(id)}
          >
            {tagLabel}
          </button>
        );
      })}
    </div>
  );

  if (presentation === "inline") {
    return <div className={styles.inline}>{chips}</div>;
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`${styles.trigger} ${compact ? styles.compactTrigger : ""}`}
        onClick={() => setVisible(true)}
      >
        <span>{label}</span>
        <span className={styles.count}>{compact ? selected.length : selected.length ? selected.length : "None"}</span>
      </button>

      <dialog
        ref={dialogRef}
        className={styles.overlay}
        aria-label={label}
        onClick={(event) => {
          if (event.target === event.currentTarget) setVisible(false);
        }}
        onClose={() => {
          setVisible(false);
          triggerRef.current?.focus();
        }}
      >
        <section className={styles.sheet} aria-labelledby="route-tag-picker-title">
          <header className={styles.header}>
            <h2 id="route-tag-picker-title" className={styles.title}>{label}</h2>
            <button type="button" autoFocus className="btn btn-ghost" onClick={() => setVisible(false)}>Done</button>
          </header>
          <div className={styles.content}>
            {helperText && <p className={styles.helperText}>{helperText}</p>}
            {chips}
          </div>
          <footer className={styles.footer}>
            <button type="button" className="btn btn-ghost" onClick={() => onChange([])}>Clear</button>
            <span className={styles.selectedCount} aria-live="polite">
              {matchingCount !== undefined
                ? `${matchingCount} matching route${matchingCount === 1 ? "" : "s"}`
                : selected.length ? `${selected.length} selected` : "No tags selected"}
            </span>
          </footer>
        </section>
      </dialog>
    </>
  );
}
