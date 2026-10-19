import { parseRouteTags, routeTags } from "../lib/routeTags";
import styles from "./RouteTags.module.css";

interface RouteTagsProps {
  tags: unknown;
}

/** Non-interactive route style badges; unknown values and missing cached data are omitted. */
export default function RouteTags({ tags }: RouteTagsProps) {
  const ids = new Set(parseRouteTags(tags));
  const visibleTags = routeTags.filter(({ id }) => ids.has(id));
  if (visibleTags.length === 0) return null;

  return (
    <ul className={styles.tags} aria-label="Route style tags">
      {visibleTags.map(({ id, label }) => <li key={id} className={styles.tag}>{label}</li>)}
    </ul>
  );
}
