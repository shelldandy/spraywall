import { useRef, type KeyboardEvent } from "react";
import styles from "./StarRating.module.css";

interface StarRatingProps {
  value: number | null;
  onChange: (stars: number) => void;
  disabled?: boolean;
  label?: string;
}

export default function StarRating({ value, onChange, disabled = false, label = "Your community rating" }: StarRatingProps) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    event.preventDefault();
    const active = refs.current.findIndex((button) => button === document.activeElement);
    const next = event.key === "ArrowRight" ? Math.min(4, active + 1) : Math.max(0, active - 1);
    refs.current[next]?.focus();
  }
  return (
    <div className={styles.stars} role="group" aria-label={label} onKeyDown={onKeyDown}>
      {Array.from({ length: 5 }, (_, index) => {
        const stars = index + 1;
        return <button
          key={stars}
          ref={(node) => { refs.current[index] = node; }}
          type="button"
          className={styles.star}
          aria-label={`${stars} star${stars === 1 ? "" : "s"}`}
          aria-pressed={value === stars}
          disabled={disabled}
          onClick={() => onChange(stars)}
        >{stars <= (value ?? 0) ? "★" : "☆"}</button>;
      })}
    </div>
  );
}
