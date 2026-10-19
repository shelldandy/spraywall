import { useState, type FormEvent } from "react";
import type { ClimbLog, ClimbOutcome } from "../lib/api/types";
import { canFlash, localCalendarDate } from "../lib/climbLogs";
import styles from "./ClimbLogForm.module.css";

interface ClimbLogFormProps {
  history: ClimbLog[];
  initial?: ClimbLog;
  submitting: boolean;
  onSubmit: (input: { outcome: ClimbOutcome; climbed_on: string; notes: string | null }) => Promise<void>;
  onCancel?: () => void;
}

export default function ClimbLogForm({ history, initial, submitting, onSubmit, onCancel }: ClimbLogFormProps) {
  const [outcome, setOutcome] = useState<ClimbOutcome>(initial?.outcome ?? "attempt");
  const [date, setDate] = useState(initial?.climbed_on ?? localCalendarDate());
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [error, setError] = useState("");
  const canChooseFlash = canFlash(history.filter((log) => log.id !== initial?.id).map((log) => log.outcome));
  const tickOptions: { outcome: ClimbOutcome; label: string; emoji: string }[] = [
    { outcome: "attempt", label: "Attempt", emoji: "❌" },
    { outcome: "send", label: "Send", emoji: "✅" },
    ...(canChooseFlash || outcome === "flash" ? [{ outcome: "flash" as const, label: "Flash", emoji: "⚡" }] : []),
  ];

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    try { await onSubmit({ outcome, climbed_on: date, notes: notes.trim() || null }); }
    catch (err) { setError(err instanceof Error ? err.message : "Could not save climb"); }
  }

  return (
    <form className={styles.form} onSubmit={submit}>
      <fieldset className={styles.tickFieldset}>
        <legend className={styles.tickLegend}>Tick</legend>
        <div className={styles.tickOptions} role="group" aria-label="Choose tick type">
          {tickOptions.map(({ outcome: option, label, emoji }) => (
            <button
              key={option}
              type="button"
              className={`${styles.tickOption} ${outcome === option ? styles.tickOptionSelected : ""}`}
              aria-pressed={outcome === option}
              onClick={() => setOutcome(option)}
            >
              <span className={styles.tickEmoji} aria-hidden="true">{emoji}</span>
              <span>{label}</span>
            </button>
          ))}
        </div>
      </fieldset>
      <label className={styles.label}>Date climbed
        <input type="date" value={date} max={localCalendarDate()} onChange={(event) => setDate(event.target.value)} required />
      </label>
      <label className={styles.label}>Notes <span className={styles.optional}>(optional)</span>
        <textarea rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="How did it go?" />
      </label>
      {error && <p className="error-text" role="alert">{error}</p>}
      <div className={styles.actions}>
        {onCancel && <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={submitting}>Cancel</button>}
        <button type="submit" className="btn btn-primary" disabled={submitting || !date}>{submitting ? "Saving…" : initial ? "Save changes" : "Log climb"}</button>
      </div>
    </form>
  );
}
