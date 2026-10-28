import { useEffect, useMemo, useRef, useState } from "react";
import { getGradeColorStyle, grades, gradeSystems, type GradeSystem } from "../lib/grades";
import styles from "./GradePicker.module.css";

interface GradePickerProps {
  selectedGradeId: number | null;
  onSelect: (gradeId: number | null) => void;
  system?: GradeSystem;
}

/** A trigger button that opens a bottom sheet listing grades in the chosen grading system. */
export default function GradePicker({ selectedGradeId, onSelect, system = "v" }: GradePickerProps) {
  const [visible, setVisible] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [activeSystem, setActiveSystem] = useState<GradeSystem>(system);

  const selected = selectedGradeId !== null ? grades.find((g) => g.id === selectedGradeId) : null;
  const displayLabel = selected ? selected[activeSystem] : "Select grade";

  const displayGrades = useMemo(() => {
    const seen = new Set<string>();
    return grades.filter((g) => {
      const label = g[activeSystem];
      if (seen.has(label)) return false;
      seen.add(label);
      return true;
    });
  }, [activeSystem]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (visible) {
      if (!dialog.open) {
        dialog.showModal();
        // Keep the modal itself focused so its offscreen opening animation doesn't scroll the dialog.
        dialog.focus({ preventScroll: true });
        dialog.scrollTop = 0;
      }
      dialog.firstElementChild?.classList.remove(styles.sheetClosing);
    } else if (dialog.open) dialog.firstElementChild?.classList.add(styles.sheetClosing);
  }, [visible]);

  const requestClose = () => dialogRef.current?.firstElementChild?.classList.add(styles.sheetClosing);
  const choose = (gradeId: number | null) => {
    onSelect(gradeId);
    requestClose();
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`${styles.trigger} ${selected ? "" : styles.placeholder}`}
        onClick={() => setVisible(true)}
      >
        {selected ? (
          <span className={styles.gradeText} style={getGradeColorStyle(selected.v)}>
            {displayLabel}
          </span>
        ) : (
          displayLabel
        )}
      </button>

      <dialog
        ref={dialogRef}
        className={styles.overlay}
        aria-label="Select Grade"
        tabIndex={-1}
        onClick={(e) => {
          if (e.target === e.currentTarget) requestClose();
        }}
        onCancel={(e) => {
          e.preventDefault();
          requestClose();
        }}
        onClose={() => {
          dialogRef.current?.firstElementChild?.classList.remove(styles.sheetClosing);
          setVisible(false);
          triggerRef.current?.focus();
        }}
      >
        <div
          className={styles.sheet}
          onAnimationEnd={(event) => {
            if (event.target === event.currentTarget && event.currentTarget.classList.contains(styles.sheetClosing)) {
              dialogRef.current?.close();
            }
          }}
        >
          <div className={styles.sheetHeader}>
            <h2 className={styles.sheetTitle}>Select Grade</h2>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={requestClose}
            >
              Done
            </button>
          </div>

          <div className={styles.systemTabs}>
            {gradeSystems.map((gs) => (
              <button
                key={gs.value}
                type="button"
                className={`${styles.systemTab} ${activeSystem === gs.value ? styles.systemTabActive : ""}`}
                onClick={() => setActiveSystem(gs.value)}
              >
                {gs.label}
              </button>
            ))}
          </div>

          <ul className={styles.list}>
            <li>
              <button type="button" className={`${styles.row} ${styles.clear}`} onClick={() => choose(null)}>
                No grade
              </button>
            </li>
            {displayGrades.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className={`${styles.row} ${selectedGradeId === item.id ? styles.rowSelected : ""}`}
                  onClick={() => choose(item.id)}
                >
                  <span className={styles.gradeText} style={getGradeColorStyle(item.v)}>
                    {item[activeSystem]}
                  </span>
                  <span className={styles.gradeSubText}>
                    {activeSystem === "v" ? item.font : item.v}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </dialog>
    </>
  );
}
