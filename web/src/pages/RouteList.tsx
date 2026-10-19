import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import HoldOverlay from "../components/HoldOverlay";
import RouteTagPicker from "../components/RouteTagPicker";
import RouteTags from "../components/RouteTags";
import type { Hold, Route } from "../lib/api/types";
import { getGradeColorStyle, getVGradeRank, isVGradeWithinRange, uniqueVGrades } from "../lib/grades";
import { parseRouteTags, routeHasAnyTag, type RouteTagId } from "../lib/routeTags";
import styles from "./RouteList.module.css";

const vGradeValues = new Set(uniqueVGrades().map(({ v }) => v));

function parseGradeBound(values: string[]): string | null {
  for (const value of values) {
    const grade = value.trim().toUpperCase();
    if (vGradeValues.has(grade)) return grade;
  }
  return null;
}

function writeFilters(
  params: URLSearchParams,
  tags: readonly RouteTagId[],
  minGrade: string | null,
  maxGrade: string | null,
): URLSearchParams {
  params.delete("tag");
  for (const tag of parseRouteTags(tags)) params.append("tag", tag);
  params.delete("minGrade");
  if (minGrade) params.set("minGrade", minGrade);
  params.delete("maxGrade");
  if (maxGrade) params.set("maxGrade", maxGrade);
  return params;
}

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
  const [gradePickerOpen, setGradePickerOpen] = useState(false);
  const gradeTriggerRef = useRef<HTMLButtonElement>(null);
  const gradeDialogRef = useRef<HTMLDialogElement>(null);
  const selectedTags = parseRouteTags(searchParams.getAll("tag"));
  const minGrade = parseGradeBound(searchParams.getAll("minGrade"));
  const requestedMaxGrade = parseGradeBound(searchParams.getAll("maxGrade"));
  const minRank = minGrade === null ? null : getVGradeRank(minGrade);
  const requestedMaxRank = requestedMaxGrade === null ? null : getVGradeRank(requestedMaxGrade);
  const maxGrade = minRank !== null && requestedMaxRank !== null && minRank > requestedMaxRank
    ? null
    : requestedMaxGrade;
  const gradeOptions = uniqueVGrades();

  useEffect(() => {
    const dialog = gradeDialogRef.current;
    if (!dialog) return;
    if (gradePickerOpen && !dialog.open) dialog.showModal();
    else if (!gradePickerOpen && dialog.open) dialog.close();
  }, [gradePickerOpen]);

  useEffect(() => {
    const rawTags = searchParams.getAll("tag");
    const canonicalTags = parseRouteTags(rawTags);
    const rawMinGrades = searchParams.getAll("minGrade");
    const rawMaxGrades = searchParams.getAll("maxGrade");
    const tagsAreCanonical = rawTags.length === canonicalTags.length
      && rawTags.every((tag, index) => tag === canonicalTags[index]);
    const minGradeIsCanonical = rawMinGrades.length === (minGrade === null ? 0 : 1)
      && (minGrade === null || rawMinGrades[0] === minGrade);
    const maxGradeIsCanonical = rawMaxGrades.length === (maxGrade === null ? 0 : 1)
      && (maxGrade === null || rawMaxGrades[0] === maxGrade);
    if (tagsAreCanonical && minGradeIsCanonical && maxGradeIsCanonical) return;

    const canonicalParams = new URLSearchParams(searchParams);
    writeFilters(canonicalParams, canonicalTags, minGrade, maxGrade);
    setSearchParams(canonicalParams, { replace: true });
  }, [searchParams, setSearchParams, minGrade, maxGrade]);

  const matchingRoutes = routes.filter((route) =>
    routeHasAnyTag(route.tags, selectedTags)
    && isVGradeWithinRange(route.grade, minGrade, maxGrade),
  );
  const hasGradeFilter = minGrade !== null || maxGrade !== null;
  const hasActiveFilters = selectedTags.length > 0 || hasGradeFilter;

  const updateFilters = (
    tags: readonly RouteTagId[],
    nextMinGrade: string | null,
    nextMaxGrade: string | null,
  ) => {
    const nextParams = writeFilters(new URLSearchParams(searchParams), tags, nextMinGrade, nextMaxGrade);
    setSearchParams(nextParams, { replace: true });
  };
  const updateTags = (tags: readonly RouteTagId[]) => updateFilters(tags, minGrade, maxGrade);
  const clearFilters = () => updateFilters([], null, null);
  const selectGrade = (grade: string) => {
    const rank = getVGradeRank(grade)!;
    if (minGrade === null && maxGrade === null) {
      updateFilters(selectedTags, grade, grade);
      return;
    }

    if (minGrade !== null && maxGrade !== null) {
      const currentMinRank = getVGradeRank(minGrade)!;
      const currentMaxRank = getVGradeRank(maxGrade)!;
      if (currentMinRank === currentMaxRank) {
        const lower = rank < currentMinRank ? grade : minGrade;
        const upper = rank > currentMinRank ? grade : minGrade;
        updateFilters(selectedTags, lower, upper);
      } else {
        updateFilters(selectedTags, grade, grade);
      }
      return;
    }

    const existing = minGrade ?? maxGrade!;
    const existingRank = getVGradeRank(existing)!;
    updateFilters(selectedTags, rank < existingRank ? grade : existing, rank > existingRank ? grade : existing);
  };
  const gradeSummary = minGrade !== null && maxGrade !== null
    ? minGrade === maxGrade ? minGrade : `${minGrade}–${maxGrade}`
    : minGrade !== null ? `${minGrade}+` : maxGrade !== null ? `≤${maxGrade}` : "Grade";
  const noMatchesMessage = selectedTags.length > 0 && hasGradeFilter
    ? "No routes match these grade and tag filters"
    : hasGradeFilter
      ? "No routes match this grade range"
      : "No routes match these tags";

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
        <button
          ref={gradeTriggerRef}
          type="button"
          className={`${styles.gradeToggle} ${hasGradeFilter ? styles.gradeToggleActive : ""}`}
          aria-expanded={gradePickerOpen}
          aria-controls="route-grade-options"
          onClick={() => setGradePickerOpen(true)}
        >
          {hasGradeFilter && <span aria-hidden="true">✓</span>}
          {gradeSummary}
        </button>
      </div>
      <dialog
        ref={gradeDialogRef}
        id="route-grade-options"
        className={styles.gradeOverlay}
        aria-label="Filter by V-grade"
        onClick={(event) => {
          if (event.target === event.currentTarget) setGradePickerOpen(false);
        }}
        onClose={() => {
          setGradePickerOpen(false);
          gradeTriggerRef.current?.focus();
        }}
      >
        <section className={styles.gradeSheet} aria-labelledby="route-grade-picker-title">
          <header className={styles.gradeHeader}>
            <h2 id="route-grade-picker-title" className={styles.gradeTitle}>Grade</h2>
            <button type="button" autoFocus className="btn btn-ghost" onClick={() => setGradePickerOpen(false)}>Done</button>
          </header>
          <div className={styles.gradeContent}>
            <p className={styles.gradeHelper}>Select one grade, then another to set an inclusive range.</p>
            <div className={styles.gradeOptions} role="group" aria-label="Choose a V-grade range">
              <button
                type="button"
                className={`${styles.gradeOption} ${!hasGradeFilter ? styles.gradeOptionAnySelected : ""}`}
                aria-pressed={!hasGradeFilter}
                onClick={() => updateFilters(selectedTags, null, null)}
              >
                Any
              </button>
              {gradeOptions.map(({ v }) => {
                const gradeRank = getVGradeRank(v)!;
                const isEndpoint = v === minGrade || v === maxGrade;
                const maxRank = maxGrade === null ? null : getVGradeRank(maxGrade);
                const isInRange = hasGradeFilter
                  && (minRank === null || gradeRank >= minRank)
                  && (maxRank === null || gradeRank <= maxRank);
                const colorStyle = getGradeColorStyle(v);
                const swatchStyle = colorStyle ? {
                  borderColor: colorStyle.backgroundColor,
                  ...(isInRange
                    ? colorStyle
                    : {
                      backgroundColor: `color-mix(in srgb, ${colorStyle.backgroundColor} 12%, var(--bg-elevated))`,
                      color: colorStyle.backgroundColor,
                    }),
                } : undefined;
                return (
                  <button
                    key={v}
                    type="button"
                    className={`${styles.gradeOption} ${isEndpoint ? styles.gradeOptionSelected : ""} ${isInRange && !isEndpoint ? styles.gradeOptionInRange : ""}`}
                    style={swatchStyle}
                    aria-pressed={isEndpoint || isInRange}
                    onClick={() => selectGrade(v)}
                  >
                    {v}
                  </button>
                );
              })}
            </div>
          </div>
          <footer className={styles.gradeFooter}>
            <button type="button" className="btn btn-ghost" onClick={() => updateFilters(selectedTags, null, null)}>Clear</button>
            <span className={styles.gradeCount} aria-live="polite">
              {matchingRoutes.length} matching route{matchingRoutes.length === 1 ? "" : "s"}
            </span>
          </footer>
        </section>
      </dialog>
      {hasActiveFilters && matchingRoutes.length === 0 && (
        <div className={styles.noMatches} role="status">
          <span>{noMatchesMessage}</span>
          <button type="button" className="btn btn-ghost" onClick={clearFilters}>Clear all filters</button>
        </div>
      )}
      {matchingRoutes.length > 0 && (
        <ul className={styles.list}>
          {matchingRoutes.map((route) => {
            const linkParams = writeFilters(new URLSearchParams(searchParams), selectedTags, minGrade, maxGrade);
            linkParams.set("wallId", wallId);
            linkParams.set("gymSlug", gymSlug);
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
