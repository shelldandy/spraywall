import { Link, useNavigate, useSearchParams } from "react-router";
import { useHolds, useRoutes, useWallDetail } from "../lib/hooks/queries";
import HoldOverlay from "../components/HoldOverlay";
import type { Hold, Route } from "../lib/api/types";
import styles from "./Routes.module.css";

function RouteThumbnail({ route, holds, imageUrl }: { route: Route; holds: Hold[]; imageUrl: string | null }) {
  const selectedIds = new Set(route.hold_ids);
  const routeHolds = holds.filter((hold) => selectedIds.has(hold.id));

  return (
    <div className={styles.thumbnail}>
      {imageUrl ? (
        // The frame shrink-wraps the contained image so the overlay lines up with it.
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

export default function RoutesPage() {
  const [params] = useSearchParams();
  const wallId = params.get("wallId") ?? "";
  const gymSlug = params.get("gymSlug") ?? undefined;
  const navigate = useNavigate();

  const routesQuery = useRoutes(wallId, gymSlug);
  const wallQuery = useWallDetail(wallId, gymSlug);
  const holdsQuery = useHolds(wallId, wallQuery.data?.detection_status === "done", gymSlug);

  const routes = routesQuery.data ?? [];
  const holds = holdsQuery.data ?? [];
  const imageUrl = wallQuery.data?.image?.image_url ?? null;

  const goBack = () => {
    // react-router stores the history index; idx 0 means this page was opened directly.
    if ((window.history.state?.idx ?? 0) > 0) navigate(-1);
    else navigate(`/walls/${wallId}?${new URLSearchParams({ gymSlug: gymSlug ?? "" })}`, { replace: true });
  };

  const detailHref = (routeId: string) =>
    `/routes/${routeId}?${new URLSearchParams({ wallId, gymSlug: gymSlug ?? "" })}`;

  return (
    <div className="screen">
      <header className="header">
        <button type="button" className={`btn btn-ghost ${styles.side}`} onClick={goBack}>
          {"< Back"}
        </button>
        <h1 className={styles.title}>Routes</h1>
        <span className={styles.side} />
      </header>

      <main className={`content ${styles.body}`}>
        {routesQuery.isLoading ? (
          <div className={styles.loader}>
            <div className="spinner" />
          </div>
        ) : routesQuery.isError ? (
          <p className={`error-text ${styles.empty}`}>{routesQuery.error.message}</p>
        ) : routes.length === 0 ? (
          <p className={styles.empty}>No routes yet. Select holds on the wall to create one.</p>
        ) : (
          <ul className={styles.list}>
            {routes.map((item) => (
              <li key={item.id}>
                <Link to={detailHref(item.id)} className={styles.routeRow}>
                  <RouteThumbnail route={item} holds={holds} imageUrl={imageUrl} />
                  <div className={styles.routeInfo}>
                    <div className={styles.routeName}>{item.name}</div>
                    <div className={styles.routeMeta}>
                      {item.send_count} send{item.send_count !== 1 ? "s" : ""}
                      <span className={styles.metaSeparator}> · </span>
                      {item.hold_ids.length} hold{item.hold_ids.length !== 1 ? "s" : ""}
                    </div>
                    {(item.status === "draft" || item.is_legacy || item.has_sent) && (
                      <div className={styles.badges}>
                        {item.status === "draft" && (
                          <span className={`${styles.badge} ${styles.draftBadge}`}>Draft</span>
                        )}
                        {item.is_legacy && <span className={`${styles.badge} ${styles.resetBadge}`}>Reset</span>}
                        {item.has_sent && <span className={`${styles.badge} ${styles.sentBadge}`}>Sent</span>}
                      </div>
                    )}
                  </div>
                  <div className={styles.gradeColumn}>{item.grade ?? "—"}</div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
