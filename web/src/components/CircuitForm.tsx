import { useId, useState, type CSSProperties, type FormEvent } from "react";
import { generateRouteName } from "../lib/routeNames";
import { CIRCUIT_COLORS, CIRCUIT_EMOJI, circuitColor, randomCircuitStyle, type CircuitColor } from "../lib/circuitStyle";
import styles from "./CircuitForm.module.css";

export interface CircuitFormValues {
  name: string;
  color: string;
  emoji: string;
}

interface CircuitFormProps {
  initial?: CircuitFormValues;
  submitLabel: string;
  pending: boolean;
  onSubmit: (values: CircuitFormValues) => void | Promise<void>;
  onCancel: () => void;
}

export default function CircuitForm({ initial, submitLabel, pending, onSubmit, onCancel }: CircuitFormProps) {
  const nameInputId = `circuit-name-${useId().replaceAll(":", "")}`;
  const [name, setName] = useState(initial?.name ?? "");
  const [suggestion, setSuggestion] = useState(() => generateRouteName());
  const [style, setStyle] = useState(() => initial ? { color: initial.color, emoji: initial.emoji } : randomCircuitStyle());

  const rollName = () => {
    const next = generateRouteName(name);
    setName(next);
    setSuggestion(generateRouteName(next));
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const cleanName = name.trim();
    void onSubmit({ name: cleanName || (initial ? "" : suggestion), color: style.color, emoji: style.emoji });
  };

  return (
    <form className={styles.form} onSubmit={submit}>
      <label className={styles.label} htmlFor={nameInputId}>Name</label>
      <div className={styles.nameRow}>
        <input
          id={nameInputId}
          className={`input ${styles.nameInput}`}
          placeholder={`e.g. ${suggestion}`}
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={60}
          autoComplete="off"
          enterKeyHint="done"
        />
        <button type="button" className={`btn ${styles.diceButton}`} onClick={rollName} aria-label="Generate random name" title="Generate random name">🎲</button>
      </div>

      <fieldset className={styles.fieldset}>
        <legend className={styles.label}>Color</legend>
        <div className={styles.colorChoices} role="group" aria-label="Choose circuit color">
          {(Object.entries(CIRCUIT_COLORS) as [CircuitColor, string][]).map(([key, value]) => (
            <button
              key={key}
              type="button"
              className={styles.colorChoice}
              style={{ "--swatch-color": value } as CSSProperties}
              aria-label={`${key} color`}
              aria-pressed={style.color === key}
              onClick={() => setStyle((current) => ({ ...current, color: key }))}
            />
          ))}
        </div>
      </fieldset>

      <fieldset className={styles.fieldset}>
        <legend className={styles.label}>Emoji</legend>
        <div className={styles.emojiChoices} role="group" aria-label="Choose circuit emoji">
          {CIRCUIT_EMOJI.map((emoji) => (
            <button key={emoji} type="button" className={styles.emojiChoice} aria-label={emoji} aria-pressed={style.emoji === emoji} onClick={() => setStyle((current) => ({ ...current, emoji }))}>{emoji}</button>
          ))}
        </div>
      </fieldset>

      <div className={styles.footer}>
        <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={pending}>Cancel</button>
        <button type="submit" className="btn btn-primary" disabled={pending}>{pending ? "Saving…" : submitLabel}</button>
      </div>
    </form>
  );
}

export function CircuitBadge({ circuit, className = "" }: { circuit: CircuitFormValues; className?: string }) {
  const color = circuitColor(circuit.color);
  return <span className={`${styles.badge} ${className}`} style={{ "--badge-color": color } as CSSProperties}><span className={styles.badgeEmoji}>{circuit.emoji}</span><span>{circuit.name}</span></span>;
}
