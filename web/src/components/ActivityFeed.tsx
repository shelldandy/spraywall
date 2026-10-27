import { Link } from "react-router";
import { useActivity } from "../lib/hooks/queries";
import { formatRelativeTime, calendarParts } from "../lib/climbLogs";
import { getGradeColorStyle } from "../lib/grades";
import { initials } from "../lib/initials";
import type { ActivityItem } from "../lib/api/types";
import styles from "./ActivityFeed.module.css";

interface ActivityFeedProps {
  gymSlug: string;
  wallId: string;
  routeId?: string;
  showRoute: boolean;
}

const outcomeVerbs: Record<ActivityItem["outcome"], string> = {
  attempt: "attempted",
  send: "sent",
  flash: "flashed",
};

export default function ActivityFeed({ gymSlug, wallId, routeId, showRoute }: ActivityFeedProps) {
  const query = useActivity({ gymSlug, wallId, routeId });
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];

  if (query.isLoading) {
    return <div className={styles.loading}><div className="spinner" /></div>;
  }
  if (query.isError && !query.data) {
    return <p className="error-text" role="alert">{query.error.message}</p>;
  }
  if (items.length === 0) {
    return <p className={styles.empty}>No activity yet</p>;
  }

  return (
    <div className={styles.feed}>
      {query.isError && <p className="error-text" role="alert">{query.error.message}</p>}
      <ol className={styles.timeline}>
        {items.map((item, index) => {
          const dateChanged = index === 0 || items[index - 1].climbed_on !== item.climbed_on;
          const date = calendarParts(item.climbed_on);
          const name = showRoute ? (
            <Link to={`/routes/${item.route_id}?${new URLSearchParams({ wallId, gymSlug })}`}>
              {item.route_name}
            </Link>
          ) : item.route_name;
          const gradeStyle = item.route_grade ? getGradeColorStyle(item.route_grade) : undefined;
          return (
            <li className={styles.entry} key={item.id}>
              <div className={styles.dateColumn}>
                {dateChanged && (
                  <time className={styles.dateBadge} dateTime={item.climbed_on}>
                    <span className={styles.weekday}>{date.weekday}</span>
                    <strong className={styles.day}>{date.day}</strong>
                    <span className={styles.month}>{date.month}</span>
                  </time>
                )}
              </div>
              <article className={styles.activity}>
                <div className={styles.activityHeader}>
                  {item.user.avatar_url ? (
                    <img className={styles.avatar} src={item.user.avatar_url} alt="" />
                  ) : (
                    <span className={`${styles.avatar} ${styles.avatarInitials}`} aria-hidden="true">
                      {initials(item.user.display_name) || "?"}
                    </span>
                  )}
                  <p className={styles.summary}>
                    <strong>{item.user.display_name}</strong> {outcomeVerbs[item.outcome]} <span className={styles.routeName}>{name}</span>
                    <span className={styles.relativeTime}> · {formatRelativeTime(item.climbed_on)}</span>
                  </p>
                </div>
                <div className={styles.pills}>
                  {showRoute && item.route_grade && (
                    <span className={styles.grade} style={gradeStyle}>{item.route_grade}</span>
                  )}
                  <span className={`${styles.outcome} ${styles[item.outcome]}`}>{item.outcome}</span>
                </div>
                {item.notes && <p className={styles.notes}>{item.notes}</p>}
              </article>
            </li>
          );
        })}
      </ol>
      {query.hasNextPage && (
        <button
          type="button"
          className={`btn btn-ghost ${styles.loadMore}`}
          onClick={() => void query.fetchNextPage()}
          disabled={query.isFetchingNextPage}
        >
          {query.isFetchingNextPage ? "Loading…" : "Load more"}
        </button>
      )}
    </div>
  );
}
