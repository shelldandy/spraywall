import { useMemo } from "react";
import { useNavigate } from "react-router";
import type { LogbookEntry } from "../lib/api/types";
import { useLogbook } from "../lib/hooks/queries";
import styles from "./Logbook.module.css";

interface LogbookSection {
  title: string;
  data: LogbookEntry[];
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function LogbookPage() {
  const navigate = useNavigate();
  const logbookQuery = useLogbook();

  const sections: LogbookSection[] = useMemo(() => {
    const grouped = new Map<string, LogbookEntry[]>();
    for (const entry of logbookQuery.data ?? []) {
      const existing = grouped.get(entry.wall_name);
      if (existing) existing.push(entry);
      else grouped.set(entry.wall_name, [entry]);
    }
    return Array.from(grouped.entries()).map(([title, data]) => ({ title, data }));
  }, [logbookQuery.data]);

  const goBack = () => {
    // react-router stores the history index in history.state; idx 0 means we were opened directly.
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) navigate(-1);
    else navigate("/walls", { replace: true });
  };

  return (
    <div className={`screen ${styles.page}`}>
      <header className="header">
        <button type="button" className={`btn btn-ghost ${styles.side}`} onClick={goBack}>
          {"< Back"}
        </button>
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
          <p className={styles.empty}>No sends yet. Go climb something!</p>
        ) : (
          sections.map((section) => (
            <section key={section.title}>
              <h2 className={styles.sectionHeader}>{section.title}</h2>
              <ul className={styles.list}>
                {section.data.map((item) => (
                  <li key={item.id} className={styles.entryCard}>
                    <div className={styles.entryInfo}>
                      <span className={styles.entryName}>{item.route_name}</span>
                      {item.route_grade && (
                        <span className={styles.entryGrade}>{item.route_grade}</span>
                      )}
                    </div>
                    <span className={styles.entryDate}>{formatDate(item.sent_at)}</span>
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
