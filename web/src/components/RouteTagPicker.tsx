import { useRef, useState } from "react";
import { parseRouteTags, routeTags, type RouteTagId } from "../lib/routeTags";
import FilterDrawer from "./FilterDrawer";
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
  const selected = parseRouteTags(selectedTags);
  const selectedSet = new Set(selected);


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
        className={`${styles.trigger} ${compact ? styles.compactTrigger : ""} ${compact && selected.length > 0 ? styles.compactTriggerActive : ""}`}
        aria-expanded={visible}
        onClick={() => setVisible(true)}
      >
        {compact && selected.length > 0 && <span aria-hidden="true">✓</span>}
        <span>{label}</span>
        {!compact && <span className={styles.count}>{selected.length ? selected.length : "None"}</span>}
      </button>

      <FilterDrawer
        open={visible}
        title={label}
        onClose={() => setVisible(false)}
        onClear={() => onChange([])}
        matchingCount={matchingCount ?? selected.length}
        countLabel={matchingCount !== undefined ? undefined : selected.length ? `${selected.length} selected` : "No tags selected"}
        triggerRef={triggerRef}
      >
        {helperText && <p className={styles.helperText}>{helperText}</p>}
        {chips}
      </FilterDrawer>
    </>
  );
}
