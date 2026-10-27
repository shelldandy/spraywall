import { useMemo } from "react";
import { Link } from "react-router";
import type { LogbookEntry } from "../lib/api/types";
import { formatCalendarDate } from "../lib/climbLogs";
import { getGradeColorStyle } from "../lib/grades";
import { useLogbook } from "../lib/hooks/queries";
import styles from "./Logbook.module.css";

interface LogbookSection {
  wallId: string;
  title: string;
  data: LogbookEntry[];
}

export default function LogbookPage() {
  const logbookQuery = useLogbook();

  const sections: LogbookSection[] = useMemo(() => {
    const grouped = new Map<string, { title: string; data: LogbookEntry[] }>();
    for (const entry of logbookQuery.data ?? []) {
      const existing = grouped.get(entry.wall_id);
      if (existing) existing.data.push(entry);
      else grouped.set(entry.wall_id, { title: entry.wall_name, data: [entry] });
    }
    return Array.from(grouped.entries()).map(([wallId, section]) => ({ wallId, ...section }));
  }, [logbookQuery.data]);

  return (
    <div className={`screen ${styles.page}`}>
      <header className="header">
        <div className={styles.side} />
        <h1 className={styles.title}>Logbook</h1>
        <div className={styles.side} />
      </header>

      <main className="content">
        {logbookQuery.isLoading ? (
          <div className={styles.loader}>
            <div className="spinner" />
          </div>
        ) : logbookQuery.isError && sections.length === 0 ? (
          <p className={`error-text ${styles.empty}`}>{logbookQuery.error.message}</p>
        ) : sections.length === 0 ? (
          <p className={styles.empty}>No climbs logged yet. Go climb something!</p>
        ) : (
          sections.map((section) => (
            <section key={section.wallId}>
              <h2 className={styles.sectionHeader}>{section.title}</h2>
              <ul className={styles.list}>
                {section.data.map((item) => (
                  <li key={item.id}>
                    <Link className={styles.entryCard} to={`/routes/${item.route_id}?${new URLSearchParams({ wallId: item.wall_id, gymSlug: item.gym_slug, from: "logbook" })}`}>
                      <div className={styles.entryInfo}>
                        <span className={styles.entryName}>{item.route_name}</span>
                        <span className={`${styles.outcome} ${styles[item.outcome]}`}>{item.outcome}</span>
                        {item.route_grade && <span className={styles.entryGrade} style={getGradeColorStyle(item.route_grade)}>{item.route_grade}</span>}
                        {item.notes && <span className={styles.notes}>{item.notes}</span>}
                      </div>
                      <span className={styles.entryDate}>{formatCalendarDate(item.climbed_on)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </main>
    </div>
  );
}
