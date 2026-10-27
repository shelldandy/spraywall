import { parseRouteTags, routeTags } from "../lib/routeTags";
import styles from "./RouteTags.module.css";

interface RouteTagsProps {
  tags: unknown;
  compact?: boolean;
  inline?: boolean;
  maxVisible?: number;
}

/** Non-interactive route style badges; unknown values and missing cached data are omitted. */
export default function RouteTags({ tags, compact = false, inline = false, maxVisible }: RouteTagsProps) {
  const ids = new Set(parseRouteTags(tags));
  const allTags = routeTags.filter(({ id }) => ids.has(id));
  if (allTags.length === 0) return null;

  const visibleTags = maxVisible === undefined ? allTags : allTags.slice(0, maxVisible);
  const hiddenTags = allTags.slice(visibleTags.length);
  const hiddenLabels = hiddenTags.map(({ label }) => label).join(", ");

  if (compact) {
    return (
      <>
        {visibleTags.map(({ id, label }) => <span key={id} className={`${styles.tag} ${styles.compactTag}`}>{label}</span>)}
        {hiddenTags.length > 0 && (
          <span
            className={`${styles.tag} ${styles.compactTag}`}
            aria-label={`${hiddenTags.length} more style tag${hiddenTags.length === 1 ? "" : "s"}: ${hiddenLabels}`}
            title={`More styles: ${hiddenLabels}`}
          >
            +{hiddenTags.length}
          </span>
        )}
      </>
    );
  }

  const className = [styles.tags, inline && styles.inline].filter(Boolean).join(" ");
  return (
    <ul className={className} aria-label="Route style tags">
      {visibleTags.map(({ id, label }) => <li key={id} className={styles.tag}>{label}</li>)}
      {hiddenTags.length > 0 && (
        <li
          className={styles.tag}
          aria-label={`${hiddenTags.length} more style tag${hiddenTags.length === 1 ? "" : "s"}: ${hiddenLabels}`}
          title={`More styles: ${hiddenLabels}`}
        >
          +{hiddenTags.length}
        </li>
      )}
    </ul>
  );
}
