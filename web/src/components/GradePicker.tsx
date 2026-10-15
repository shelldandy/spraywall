import { useEffect, useMemo, useRef, useState } from "react";
import { grades, gradeSystems, type GradeSystem } from "../lib/grades";
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

    if (visible && !dialog.open) dialog.showModal();
    else if (!visible && dialog.open) dialog.close();
  }, [visible]);

  const choose = (gradeId: number | null) => {
    onSelect(gradeId);
    setVisible(false);
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`${styles.trigger} ${selected ? "" : styles.placeholder}`}
        onClick={() => setVisible(true)}
      >
        {displayLabel}
      </button>

      <dialog
        ref={dialogRef}
        className={styles.overlay}
        aria-label="Select Grade"
        onClick={(e) => {
          if (e.target === e.currentTarget) setVisible(false);
        }}
        onClose={() => {
          setVisible(false);
          triggerRef.current?.focus();
        }}
      >
        <div className={styles.sheet}>
          <div className={styles.sheetHeader}>
            <h2 className={styles.sheetTitle}>Select Grade</h2>
            <button
              type="button"
              autoFocus
              className="btn btn-ghost"
              onClick={() => setVisible(false)}
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
                  <span className={styles.gradeText}>{item[activeSystem]}</span>
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
