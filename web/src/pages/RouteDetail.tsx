import { useMemo } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { useHolds, useRouteDetail, useRoutes, useWallDetail } from "../lib/hooks/queries";
import { useLogSend, useUnsend } from "../lib/hooks/mutations";
import HoldOverlay from "../components/HoldOverlay";
import WallImage from "../components/WallImage";
import styles from "./RouteDetail.module.css";
import { useGoBack } from "../lib/nav";
import RouteList from "./RouteList";

export default function RouteDetailPage() {
  const { routeId = "" } = useParams();
  const [params] = useSearchParams();
  const wallId = params.get("wallId") ?? "";
  const gymSlug = params.get("gymSlug") ?? "";
  const navigate = useNavigate();

  const routeQuery = useRouteDetail(routeId, gymSlug, wallId);
  const routesQuery = useRoutes(wallId, gymSlug);
  const wallQuery = useWallDetail(wallId, gymSlug);
  const holdsQuery = useHolds(wallId, wallQuery.data?.detection_status === "done", gymSlug);

  const routeData = routeQuery.data;
  const wall = wallQuery.data;
  const allHolds = holdsQuery.data;

  const routeHoldIds = useMemo(() => new Set(routeData?.hold_ids ?? []), [routeData?.hold_ids]);
  const routeHolds = useMemo(
    () => (allHolds ?? []).filter((h) => routeHoldIds.has(h.id)),
    [allHolds, routeHoldIds],
  );

  const sendMutation = useLogSend(gymSlug, wallId, routeId);
  const unsendMutation = useUnsend(gymSlug, wallId, routeId);

  const isLoading = routeQuery.isLoading || wallQuery.isLoading || holdsQuery.isLoading;
  const routes = routesQuery.data ?? [];
  const allRouteHolds = allHolds ?? [];
  const imageUrl = wall?.image?.image_url ?? null;

  const goBack = useGoBack(`/routes?${new URLSearchParams({ wallId, gymSlug })}`);

  const editRoute = () => {
    const search = new URLSearchParams({
      gymSlug,
      editRouteId: routeId,
      editHoldIds: JSON.stringify(routeData?.hold_ids ?? []),
      editHoldRoles: routeData?.hold_roles ? JSON.stringify(routeData.hold_roles) : "",
      editName: routeData?.name ?? "",
      editGrade: routeData?.grade ?? "",
      editDescription: routeData?.description ?? "",
    });
    navigate(`/walls/${wallId}?${search}`);
  };

  const sendCount = routeData?.send_count ?? 0;

  return (
    <div className="screen">
      <header className="header">
        <button type="button" className={`btn btn-ghost ${styles.side}`} onClick={goBack}>
          {"< Back"}
        </button>
        <h1 className={styles.title}>{routeData?.name ?? "Route"}</h1>
        <span className={styles.side} />
      </header>

      <main className={`content ${styles.layout}`}>
        <aside className={styles.climbSidebar} aria-label="Available climbs">
          <h2 className={styles.sidebarTitle}>Climbs</h2>
          {routesQuery.isLoading ? (
            <div className={styles.sidebarLoader}>
              <div className="spinner" />
            </div>
          ) : routesQuery.isError ? (
            <p className="error-text">{routesQuery.error.message}</p>
          ) : (
            <RouteList
              routes={routes}
              holds={allRouteHolds}
              imageUrl={imageUrl}
              wallId={wallId}
              gymSlug={gymSlug}
              selectedRouteId={routeId}
            />
          )}
        </aside>
        <section className={styles.body} aria-label="Selected climb details">
          {isLoading ? (
            <div className={styles.loader}>
              <div className="spinner" />
            </div>
          ) : routeQuery.isError && !routeQuery.data ? (
            <p className={`error-text ${styles.centered}`}>{routeQuery.error.message}</p>
          ) : (
            <>
              {routeData?.is_legacy && (
                <div className={styles.legacyBanner}>This route was reset when a new wall photo was uploaded</div>
              )}

              <div className={styles.metaRow}>
                {routeData?.grade && <span className={`${styles.pill} ${styles.gradeBadge}`}>{routeData.grade}</span>}
                {routeData?.is_legacy && <span className={`${styles.pill} ${styles.resetBadge}`}>Reset</span>}
                <span className={styles.sendCount}>
                  {sendCount} send{sendCount !== 1 ? "s" : ""}
                </span>
              </div>

              {routeData?.description && <p className={styles.description}>{routeData.description}</p>}

              {wall?.image ? (
                <div className={styles.imageContainer}>
                  <WallImage src={wall.image.image_url}>
                    {routeHolds.length > 0 && (
                      <HoldOverlay
                        holds={routeHolds}
                        selectedIds={routeHoldIds}
                        onToggle={() => {}}
                        mode="view"
                        holdRoles={routeData?.hold_roles ?? null}
                      />
                    )}
                  </WallImage>
                </div>
              ) : (
                <div className={styles.noImage}>No wall image</div>
              )}

              <p className={styles.holdCount}>
                {routeHolds.length} hold{routeHolds.length !== 1 ? "s" : ""}
              </p>

              <button type="button" className={`btn btn-block ${styles.editButton}`} onClick={editRoute}>
                Edit Route
              </button>

              {routeData?.has_sent ? (
                <div className={styles.sentSection}>
                  <span className={styles.sentBadgeLarge}>Sent</span>
                  <button
                    type="button"
                    className={`btn ${styles.unsendButton}`}
                    onClick={() => unsendMutation.mutate()}
                    disabled={unsendMutation.isPending}
                  >
                    {unsendMutation.isPending ? "Removing..." : "Remove Send"}
                  </button>
                </div>
              ) : routeData?.is_legacy ? (
                <button type="button" className={`btn btn-primary btn-block ${styles.sendButton}`} disabled>
                  Route reset - sends disabled
                </button>
              ) : (
                <button
                  type="button"
                  className={`btn btn-primary btn-block ${styles.sendButton}`}
                  onClick={() => sendMutation.mutate()}
                  disabled={sendMutation.isPending}
                >
                  {sendMutation.isPending ? "Logging..." : "Log Send"}
                </button>
              )}
            </>
          )}
        </section>
      </main>
    </div>
  );
}
