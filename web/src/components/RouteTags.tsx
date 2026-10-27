import { parseRouteTags, routeTags } from "../lib/routeTags";
import styles from "./RouteTags.module.css";

interface RouteTagsProps {
  tags: unknown;
  compact?: boolean;
  inline?: boolean;
}

/** Non-interactive route style badges; unknown values and missing cached data are omitted. */
export default function RouteTags({ tags, compact = false, inline = false }: RouteTagsProps) {
  const ids = new Set(parseRouteTags(tags));
  const allTags = routeTags.filter(({ id }) => ids.has(id));
  if (allTags.length === 0) return null;

  if (compact) {
    const visibleTags = allTags.slice(0, 2);
    const hiddenTags = allTags.slice(2);
    const hiddenLabels = hiddenTags.map(({ label }) => label).join(", ");

    return (
      <>
        {visibleTags.map(({ id, label }) => <span key={id} className={`${styles.tag} ${styles.compactTag}`}>{label}</span>)}
        {hiddenTags.length > 0 && (
          <span className={`${styles.tag} ${styles.compactTag}`} title={`More styles: ${hiddenLabels}`}>
            +{hiddenTags.length}
            <span className={styles.visuallyHidden}>More style tags: {hiddenLabels}</span>
          </span>
        )}
      </>
    );
  }

  const className = [styles.tags, inline && styles.inline].filter(Boolean).join(" ");
  return (
    <ul className={className} aria-label="Route style tags">
      {allTags.map(({ id, label }) => <li key={id} className={styles.tag}>{label}</li>)}
    </ul>
  );
}
