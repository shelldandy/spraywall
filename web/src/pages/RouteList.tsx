import { Link } from "react-router";
import HoldOverlay from "../components/HoldOverlay";
import type { Hold, Route } from "../lib/api/types";
import { getGradeColorStyle } from "../lib/grades";
import styles from "./RouteList.module.css";

interface RouteListProps {
  routes: Route[];
  holds: Hold[];
  imageUrl: string | null;
  wallId: string;
  gymSlug: string;
  selectedRouteId?: string;
}

function RouteThumbnail({ route, holds, imageUrl }: { route: Route; holds: Hold[]; imageUrl: string | null }) {
  const selectedIds = new Set(route.hold_ids);
  const routeHolds = holds.filter((hold) => selectedIds.has(hold.id));

  return (
    <div className={styles.thumbnail}>
      {imageUrl ? (
        <div className={styles.thumbnailFrame}>
          <img className={styles.thumbnailImage} src={imageUrl} alt="" loading="lazy" draggable={false} />
          {routeHolds.length > 0 && (
            <div className={styles.thumbnailOverlay}>
              <HoldOverlay
                holds={routeHolds}
                selectedIds={selectedIds}
                onToggle={() => {}}
                mode="view"
                holdRoles={route.hold_roles}
              />
            </div>
          )}
        </div>
      ) : (
        <span className={styles.thumbnailPlaceholder}>▦</span>
      )}
    </div>
  );
}

export default function RouteList({
  routes,
  holds,
  imageUrl,
  wallId,
  gymSlug,
  selectedRouteId,
}: RouteListProps) {
  return (
    <ul className={styles.list}>
      {routes.map((route) => (
        <li key={route.id}>
          <Link
            to={`/routes/${route.id}?${new URLSearchParams({ wallId, gymSlug })}`}
            className={`${styles.routeRow} ${route.id === selectedRouteId ? styles.routeRowSelected : ""}`}
            aria-current={route.id === selectedRouteId ? "page" : undefined}
          >
            <RouteThumbnail route={route} holds={holds} imageUrl={imageUrl} />
            <div className={styles.routeInfo}>
              <div className={styles.routeName}>{route.name}</div>
              <div className={styles.routeMeta}>
                {route.send_count} send{route.send_count !== 1 ? "s" : ""}
                <span className={styles.metaSeparator}> · </span>
                {route.hold_ids.length} hold{route.hold_ids.length !== 1 ? "s" : ""}
              </div>
              {(route.status === "draft" || route.is_legacy || route.has_sent) && (
                <div className={styles.badges}>
                  {route.status === "draft" && <span className={`${styles.badge} ${styles.draftBadge}`}>Draft</span>}
                  {route.is_legacy && <span className={`${styles.badge} ${styles.resetBadge}`}>Reset</span>}
                  {route.has_sent && <span className={`${styles.badge} ${styles.sentBadge}`}>Sent</span>}
                </div>
              )}
            </div>
            <div className={styles.gradeColumn}>
              {route.grade ? (
                <span className={styles.gradeChip} style={getGradeColorStyle(route.grade)}>
                  {route.grade}
                </span>
              ) : (
                "—"
              )}
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
