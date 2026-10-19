import { useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { useHolds, useRouteDetail, useRouteLogs, useRoutes, useWallDetail } from "../lib/hooks/queries";
import { useCreateClimbLog, useDeleteClimbLog, useDeleteRouteRating, useSetRouteRating, useUpdateClimbLog } from "../lib/hooks/mutations";
import type { ClimbLog } from "../lib/api/types";
import { formatCalendarDate } from "../lib/climbLogs";
import ClimbLogForm from "../components/ClimbLogForm";
import StarRating from "../components/StarRating";
import { getGradeColorStyle } from "../lib/grades";
import { parseRouteTags } from "../lib/routeTags";
import { useAuthStore } from "../lib/store/auth";
import HoldOverlay from "../components/HoldOverlay";
import RouteTags from "../components/RouteTags";
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
  const userId = useAuthStore((s) => s.userId);

  const routeQuery = useRouteDetail(routeId, gymSlug, wallId);
  const routesQuery = useRoutes(wallId, gymSlug);
  const wallQuery = useWallDetail(wallId, gymSlug);
  const holdsQuery = useHolds(wallId, wallQuery.data?.detection_status === "done", gymSlug);
  const logsQuery = useRouteLogs(routeId, gymSlug, wallId);
  const [addingLog, setAddingLog] = useState(false);
  const [editingLog, setEditingLog] = useState<ClimbLog | null>(null);

  const routeData = routeQuery.data;
  const wall = wallQuery.data;
  const allHolds = holdsQuery.data;

  const routeHoldIds = useMemo(() => new Set(routeData?.hold_ids ?? []), [routeData?.hold_ids]);
  const routeHolds = useMemo(
    () => (allHolds ?? []).filter((h) => routeHoldIds.has(h.id)),
    [allHolds, routeHoldIds],
  );

  const createLog = useCreateClimbLog(gymSlug, wallId, routeId);
  const updateLog = useUpdateClimbLog(gymSlug, wallId, routeId);
  const deleteLog = useDeleteClimbLog(gymSlug, wallId, routeId);
  const setRating = useSetRouteRating(gymSlug, wallId, routeId);
  const deleteRating = useDeleteRouteRating(gymSlug, wallId, routeId);
  const history = logsQuery.data ?? [];
  const logSubmitting = createLog.isPending || updateLog.isPending;
  const resetRoute = Boolean(routeData?.is_legacy || routeData?.status === "draft");
  const submitLog = async (input: { outcome: "attempt" | "send" | "flash"; climbed_on: string; notes: string | null }) => {
    if (editingLog) { await updateLog.mutateAsync({ ...input, logId: editingLog.id }); setEditingLog(null); }
    else { await createLog.mutateAsync(input); setAddingLog(false); }
  };
  const removeLog = async (log: ClimbLog) => {
    if (!window.confirm(`Delete this ${log.outcome} entry?`)) return;
    try { await deleteLog.mutateAsync(log.id); } catch { /* The mutation error is rendered below the form. */ }
  };

  const isLoading = routeQuery.isLoading || wallQuery.isLoading || holdsQuery.isLoading;
  const routes = routesQuery.data ?? [];
  const allRouteHolds = allHolds ?? [];
  const imageUrl = wall?.image?.image_url ?? null;

  const fallbackParams = new URLSearchParams(params);
  fallbackParams.set("wallId", wallId);
  fallbackParams.set("gymSlug", gymSlug);
  fallbackParams.delete("tag");
  for (const tag of parseRouteTags(params.getAll("tag"))) fallbackParams.append("tag", tag);
  const goBack = useGoBack(`/routes?${fallbackParams}`);

  const editRoute = () => {
    const search = new URLSearchParams({
      gymSlug,
      editRouteId: routeId,
      editHoldIds: JSON.stringify(routeData?.hold_ids ?? []),
      editHoldRoles: routeData?.hold_roles ? JSON.stringify(routeData.hold_roles) : "",
      editName: routeData?.name ?? "",
      editGrade: routeData?.grade ?? "",
      editDescription: routeData?.description ?? "",
      editTags: JSON.stringify(parseRouteTags(routeData?.tags)),
    });
    navigate(`/walls/${wallId}?${search}`);
  };

  const sendCount = routeData?.send_count ?? 0;
  const isAuthor = routeData?.created_by === userId;

  return (
    <div className="screen">
      <header className="header">
        <button type="button" className={`btn btn-ghost ${styles.side}`} onClick={goBack}>
          {"< Back"}
        </button>
        <h1 className={styles.title}>{routeData?.name ?? "Route"}</h1>
        {isAuthor ? (
          <button
            type="button"
            className={`btn btn-ghost ${styles.editIconButton}`}
            onClick={editRoute}
            aria-label="Edit route"
            title="Edit route"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L8 18l-4 1 1-4Z" />
            </svg>
          </button>
        ) : (
          <span className={styles.side} />
        )}
      </header>

      <main className={`content ${styles.layout}`}>
        <aside className={styles.climbSidebar} aria-label="Available climbs">
          <h2 className={styles.sidebarTitle}>Climbs</h2>
          {routesQuery.isLoading ? (
            <div className={styles.sidebarLoader}>
              <div className="spinner" />
            </div>
          ) : routesQuery.isError && !routesQuery.data ? (
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
                {routeData?.grade && (
                  <span className={`${styles.pill} ${styles.gradeBadge}`} style={getGradeColorStyle(routeData.grade)}>
                    {routeData.grade}
                  </span>
                )}
                {routeData?.is_legacy && <span className={`${styles.pill} ${styles.resetBadge}`}>Reset</span>}
                <span className={styles.sendCount}>
                  {sendCount} send{sendCount !== 1 ? "s" : ""}
                </span>
                {routeData?.progress === "projects" && <span className={`${styles.pill} ${styles.projectBadge}`}>Projects</span>}
                {routeData?.has_sent && <span className={`${styles.pill} ${styles.sentBadge}`}>Sent</span>}
                {routeData?.has_flashed && <span className={`${styles.pill} ${styles.flashBadge}`}>Flashed</span>}
              </div>
              <RouteTags tags={routeData?.tags} />

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

              <section className={styles.ratingSection} aria-labelledby="community-rating-title">
                <h2 id="community-rating-title" className={styles.sectionTitle}>Community rating</h2>
                <p className={styles.ratingSummary}>
                  {routeData?.rating_average == null ? "Unrated" : `★ ${routeData.rating_average.toFixed(1)} out of 5`}
                  <span> · {routeData?.rating_count ?? 0} vote{routeData?.rating_count === 1 ? "" : "s"}</span>
                </p>
                {routeData?.status === "published" && <>
                  <StarRating value={routeData.my_rating ?? null} disabled={setRating.isPending || deleteRating.isPending} onChange={(stars) => setRating.mutate(stars)} />
                  {routeData.my_rating != null && <button type="button" className={`btn btn-ghost ${styles.clearRating}`} onClick={() => deleteRating.mutate()} disabled={setRating.isPending || deleteRating.isPending}>Clear rating</button>}
                  {(setRating.error || deleteRating.error) && <p className="error-text" role="alert">{setRating.error?.message ?? deleteRating.error?.message}</p>}
                </>}
              </section>

              <section className={styles.historySection} aria-labelledby="your-history-title">
                <header className={styles.historyHeader}>
                  <h2 id="your-history-title" className={styles.sectionTitle}>Your history</h2>
                  <button type="button" className="btn btn-primary" onClick={() => { setEditingLog(null); setAddingLog(true); }} disabled={resetRoute || addingLog} title={resetRoute ? "New logs are disabled on draft or reset climbs" : undefined}>Log climb</button>
                </header>
                {resetRoute && <p className={styles.historyHint}>New activity is disabled for draft or reset climbs; existing entries can still be corrected.</p>}
                {logsQuery.isLoading && <div className={styles.historyLoading}><div className="spinner" /></div>}
                {logsQuery.isError && <p className="error-text" role="alert">{logsQuery.error.message}</p>}
                {addingLog && <ClimbLogForm key="new" history={history} submitting={logSubmitting} onSubmit={submitLog} onCancel={() => setAddingLog(false)} />}
                {deleteLog.error && <p className="error-text" role="alert">{deleteLog.error.message}</p>}
                {!logsQuery.isLoading && !logsQuery.isError && history.length === 0 && !addingLog && <p className={styles.historyHint}>No activity logged yet.</p>}
                {history.length > 0 && <ul className={styles.historyList}>
                  {history.map((log) => <li key={log.id} className={styles.historyEntry}>
                    {editingLog?.id === log.id ? <ClimbLogForm key={log.id} history={history} initial={log} submitting={logSubmitting} onSubmit={submitLog} onCancel={() => setEditingLog(null)} /> : <>
                      <div className={styles.entryHeader}><span className={`${styles.outcome} ${styles[log.outcome]}`}>{log.outcome}</span><time dateTime={log.climbed_on}>{formatCalendarDate(log.climbed_on)}</time></div>
                      {log.notes && <p className={styles.logNotes}>{log.notes}</p>}
                      <div className={styles.entryActions}>
                        <button type="button" className="btn btn-ghost" onClick={() => { setAddingLog(false); setEditingLog(log); }}>Edit</button>
                        <button type="button" className="btn btn-ghost" onClick={() => void removeLog(log)} disabled={deleteLog.isPending}>Delete</button>
                      </div>
                    </>}
                  </li>)}
                </ul>}
              </section>
            </>
          )}
        </section>
      </main>
    </div>
  );
}
