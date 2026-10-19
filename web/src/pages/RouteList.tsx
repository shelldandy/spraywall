import { useEffect } from "react";
import { Link, useSearchParams } from "react-router";
import HoldOverlay from "../components/HoldOverlay";
import RouteTagPicker from "../components/RouteTagPicker";
import RouteTags from "../components/RouteTags";
import type { Hold, Route } from "../lib/api/types";
import { getGradeColorStyle } from "../lib/grades";
import { parseRouteTags, routeHasAnyTag, type RouteTagId } from "../lib/routeTags";
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
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedTags = parseRouteTags(searchParams.getAll("tag"));

  useEffect(() => {
    const rawTags = searchParams.getAll("tag");
    const canonicalTags = parseRouteTags(rawTags);
    if (rawTags.length === canonicalTags.length && rawTags.every((tag, index) => tag === canonicalTags[index])) {
      return;
    }
    const canonicalParams = new URLSearchParams(searchParams);
    canonicalParams.delete("tag");
    for (const tag of canonicalTags) canonicalParams.append("tag", tag);
    setSearchParams(canonicalParams, { replace: true });
  }, [searchParams, setSearchParams]);

  const matchingRoutes = routes.filter((route) => routeHasAnyTag(route.tags, selectedTags));
  const visibleRoutes = matchingRoutes;

  const updateTags = (tags: readonly RouteTagId[]) => {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("tag");
    for (const tag of parseRouteTags(tags)) nextParams.append("tag", tag);
    setSearchParams(nextParams, { replace: true });
  };

  const clearTags = () => updateTags([]);

  return (
    <>
      <div className={styles.filterToolbar}>
        <RouteTagPicker
          selectedTags={selectedTags}
          onChange={updateTags}
          compact
          helperText="Matches any selected tag"
          matchingCount={matchingRoutes.length}
        />
      </div>
      {selectedTags.length > 0 && matchingRoutes.length === 0 && (
        <div className={styles.noMatches} role="status">
          <span>No routes match these tags</span>
          <button type="button" className="btn btn-ghost" onClick={clearTags}>Clear</button>
        </div>
      )}
      {visibleRoutes.length > 0 && (
        <ul className={styles.list}>
          {visibleRoutes.map((route) => {
            const linkParams = new URLSearchParams(searchParams);
            linkParams.set("wallId", wallId);
            linkParams.set("gymSlug", gymSlug);
            linkParams.delete("tag");
            for (const tag of selectedTags) linkParams.append("tag", tag);
            return (
              <li key={route.id}>
                <Link
                  to={`/routes/${route.id}?${linkParams}`}
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
                    <RouteTags tags={route.tags} />
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
            );
          })}
        </ul>
      )}
    </>
  );
}
