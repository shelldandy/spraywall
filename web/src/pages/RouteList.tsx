import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import HoldOverlay from "../components/HoldOverlay";
import RouteTagPicker from "../components/RouteTagPicker";
import FilterDrawer from "../components/FilterDrawer";
import { CircuitBadge } from "../components/CircuitForm";
import RouteTags from "../components/RouteTags";
import type { Circuit, Hold, Route } from "../lib/api/types";
import { getGradeColorStyle, getVGradeRank, uniqueVGrades } from "../lib/grades";
import { circuitColor } from "../lib/circuitStyle";
import { applyCircuit, parseRouteFilters, writeRouteFilters, matchesRouteFilters, hasRouteFilters, parseRouteSort, writeRouteSort, sortRoutes, type ProgressFilter, type RouteFilters, type RouteSort } from "../lib/routeFilters";
import type { RouteTagId } from "../lib/routeTags";
import styles from "./RouteList.module.css";

const progressChoices: { value: ProgressFilter; label: string }[] = [
  { value: "unsent", label: "Unsent" },
  { value: "not_tried", label: "Not tried" },
  { value: "projects", label: "Projects" },
  { value: "sent", label: "Sent" },
];

function activeFilterCount(filters: RouteFilters): number {
  return [
    filters.tags.length > 0,
    filters.minGrade !== null || filters.maxGrade !== null,
    filters.hasBeta,
    filters.progress !== null,
    filters.minStars !== null,
    filters.circuit !== null,
  ].filter(Boolean).length;
}

interface RouteListProps {
  routes: Route[];
  holds: Hold[];
  imageUrl: string | null;
  wallId: string;
  gymSlug: string;
  selectedRouteId?: string;
  circuits?: Circuit[];
  circuitsLoaded?: boolean;
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
  circuits = [],
  circuitsLoaded = true,
}: RouteListProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const filtersTriggerRef = useRef<HTMLButtonElement>(null);
  const sortTriggerRef = useRef<HTMLButtonElement>(null);
  const filters = parseRouteFilters(searchParams);
  const sort = parseRouteSort(searchParams);
  const { tags: selectedTags, minGrade, maxGrade, progress, minStars, hasBeta } = filters;
  const minRank = minGrade === null ? null : getVGradeRank(minGrade);
  const gradeOptions = uniqueVGrades();
  const hasGradeFilter = minGrade !== null || maxGrade !== null;

  useEffect(() => {
    const currentFilters = parseRouteFilters(searchParams);
    const canonicalFilters = writeRouteFilters(new URLSearchParams(searchParams), currentFilters);
    const canonical = writeRouteSort(canonicalFilters, parseRouteSort(searchParams));
    if (canonical.toString() !== searchParams.toString()) setSearchParams(canonical, { replace: true });
  }, [searchParams, setSearchParams]);

  const activeCircuit = circuits.find((circuit) => circuit.id === filters.circuit) ?? null;
  const updateCircuit = (circuit: string | null) => {
    const nextParams = writeRouteFilters(new URLSearchParams(searchParams), { ...filters, circuit });
    setSearchParams(nextParams, { replace: true });
  };
  useEffect(() => {
    if (!circuitsLoaded || !filters.circuit || activeCircuit) return;
    const canonical = writeRouteFilters(new URLSearchParams(searchParams), { ...filters, circuit: null });
    setSearchParams(canonical, { replace: true });
  }, [circuitsLoaded, filters, activeCircuit, searchParams, setSearchParams]);
  const circuitRoutes = activeCircuit ? applyCircuit(routes, activeCircuit.route_ids) : routes;
  const matchingRoutes = sortRoutes(circuitRoutes.filter((route) => matchesRouteFilters(route, filters)), sort);
  const hasActiveFilters = hasRouteFilters(filters);
  const activeFiltersCount = activeFilterCount(filters);
  const updateFilters = (next: Partial<typeof filters>) => {
    const nextParams = writeRouteFilters(new URLSearchParams(searchParams), { ...filters, ...next });
    setSearchParams(nextParams, { replace: true });
  };
  const updateTags = (tags: readonly RouteTagId[]) => updateFilters({ tags: [...tags] });
  const updateSort = (nextSort: RouteSort) => {
    setSearchParams(writeRouteSort(new URLSearchParams(searchParams), nextSort), { replace: true });
  };
  const clearFilters = () => {
    const nextParams = writeRouteFilters(new URLSearchParams(searchParams), { ...filters, tags: [], minGrade: null, maxGrade: null, progress: null, minStars: null, circuit: null, hasBeta: false });
    setSearchParams(nextParams, { replace: true });
  };
  const selectGrade = (grade: string) => {
    const rank = getVGradeRank(grade)!;
    if (minGrade === null && maxGrade === null) { updateFilters({ minGrade: grade, maxGrade: grade }); return; }
    if (minGrade !== null && maxGrade !== null) {
      const currentMinRank = getVGradeRank(minGrade)!;
      const currentMaxRank = getVGradeRank(maxGrade)!;
      if (currentMinRank === currentMaxRank) {
        const lower = rank < currentMinRank ? grade : minGrade;
        const upper = rank > currentMinRank ? grade : minGrade;
        updateFilters({ minGrade: lower, maxGrade: upper });
      } else updateFilters({ minGrade: grade, maxGrade: grade });
      return;
    }
    const existing = minGrade ?? maxGrade!;
    const existingRank = getVGradeRank(existing)!;
    updateFilters({ minGrade: rank < existingRank ? grade : existing, maxGrade: rank > existingRank ? grade : existing });
  };
  const sortLabel = sort === "grade_asc" ? "Grade ↑" : sort === "grade_desc" ? "Grade ↓" : "Newest";
  const noMatchesMessage = "No routes match these filters";

  return (
    <>
      <div className={styles.filterToolbar}>
        <button
          ref={filtersTriggerRef}
          type="button"
          className={`${styles.gradeToggle} ${hasActiveFilters ? styles.gradeToggleActive : ""}`}
          aria-expanded={filtersOpen}
          onClick={() => setFiltersOpen(true)}
        >
          Filters{activeFiltersCount > 0 && <> · {activeFiltersCount}</>}
        </button>
        <button
          ref={sortTriggerRef}
          type="button"
          className={`${styles.gradeToggle} ${sort !== "newest" ? styles.gradeToggleActive : ""}`}
          aria-expanded={sortOpen}
          onClick={() => setSortOpen(true)}
        >
          Sort: {sortLabel}
        </button>
      </div>
      <FilterDrawer open={filtersOpen} title="Filters" onClose={() => setFiltersOpen(false)} onClear={clearFilters} matchingCount={matchingRoutes.length} triggerRef={filtersTriggerRef}>
        <section className={styles.filterSection}>
          <h3 className={styles.filterSectionTitle}>Style</h3>
          <p className={styles.gradeHelper}>Matches any selected tag</p>
          <RouteTagPicker presentation="inline" selectedTags={selectedTags} onChange={updateTags} label="Style" />
        </section>
        <section className={styles.filterSection}>
          <h3 className={styles.filterSectionTitle}>Grade</h3>
          <p className={styles.gradeHelper}>Select one grade, then another to set an inclusive range.</p>
          <div className={styles.gradeOptions} role="group" aria-label="Choose a V-grade range">
            <button type="button" className={`${styles.gradeOption} ${!hasGradeFilter ? styles.gradeOptionAnySelected : ""}`} aria-pressed={!hasGradeFilter} onClick={() => updateFilters({ minGrade: null, maxGrade: null })}>Any</button>
            {gradeOptions.map(({ v }) => {
              const rank = getVGradeRank(v)!;
              const isEndpoint = v === minGrade || v === maxGrade;
              const maxRank = maxGrade === null ? null : getVGradeRank(maxGrade);
              const inRange = hasGradeFilter && (minRank === null || rank >= minRank) && (maxRank === null || rank <= maxRank);
              const color = getGradeColorStyle(v);
              const swatch = color ? { borderColor: color.backgroundColor, ...(inRange ? color : { backgroundColor: `color-mix(in srgb, ${color.backgroundColor} 12%, var(--bg-elevated))`, color: color.backgroundColor }) } : undefined;
              return <button key={v} type="button" className={`${styles.gradeOption} ${isEndpoint ? styles.gradeOptionSelected : ""} ${inRange && !isEndpoint ? styles.gradeOptionInRange : ""}`} style={swatch} aria-pressed={isEndpoint || inRange} onClick={() => selectGrade(v)}>{v}</button>;
            })}
          </div>
        </section>
        <section className={styles.filterSection}>
          <h3 className={styles.filterSectionTitle}>Beta</h3>
          <button type="button" className={`${styles.gradeOption} ${hasBeta ? styles.gradeOptionAnySelected : ""}`} aria-pressed={hasBeta} onClick={() => updateFilters({ hasBeta: !hasBeta })}>▶ Has beta video</button>
        </section>
        <section className={styles.filterSection}>
          <h3 className={styles.filterSectionTitle}>Personal progress</h3>
          <div className={styles.gradeOptions} role="group" aria-label="Filter by personal progress">
            <button type="button" className={`${styles.gradeOption} ${progress === null ? styles.gradeOptionAnySelected : ""}`} aria-pressed={progress === null} onClick={() => updateFilters({ progress: null })}>All</button>
            {progressChoices.map(({ value, label }) => <button key={value} type="button" className={`${styles.gradeOption} ${progress === value ? styles.gradeOptionSelected : ""}`} aria-pressed={progress === value} onClick={() => updateFilters({ progress: value })}>{label}</button>)}
          </div>
        </section>
        <section className={styles.filterSection}>
          <h3 className={styles.filterSectionTitle}>Community rating</h3>
          <p className={styles.gradeHelper}>Minimum unrounded community average. Unrated climbs appear under Any.</p>
          <div className={styles.gradeOptions} role="group" aria-label="Minimum community rating">
            <button type="button" className={`${styles.gradeOption} ${minStars === null ? styles.gradeOptionAnySelected : ""}`} aria-pressed={minStars === null} onClick={() => updateFilters({ minStars: null })}>Any</button>
            {[1, 2, 3, 4, 5].map((stars) => <button key={stars} type="button" className={`${styles.gradeOption} ${minStars === stars ? styles.gradeOptionSelected : ""}`} aria-pressed={minStars === stars} onClick={() => updateFilters({ minStars: stars })}>{stars === 5 ? "5" : `${stars}+`} ★</button>)}
          </div>
        </section>
        <section className={styles.filterSection}>
          <h3 className={styles.filterSectionTitle}>Circuit</h3>
          <div className={styles.circuitChoices} role="group" aria-label="Filter by circuit">
            <button type="button" className={`${styles.gradeOption} ${!activeCircuit ? styles.gradeOptionAnySelected : ""}`} aria-pressed={!activeCircuit} onClick={() => updateCircuit(null)}>Any</button>
            {circuits.some((circuit) => circuit.is_owner) && <><h3 className={styles.circuitGroup}>Yours</h3>{circuits.filter((circuit) => circuit.is_owner).map((circuit) => <button key={circuit.id} type="button" className={`${styles.gradeOption} ${circuit.id === activeCircuit?.id ? styles.gradeOptionSelected : ""}`} style={{ borderColor: circuit.id === activeCircuit?.id ? circuitColor(circuit.color) : undefined }} aria-pressed={circuit.id === activeCircuit?.id} onClick={() => updateCircuit(circuit.id)}><CircuitBadge circuit={circuit} /></button>)}</>}
            {circuits.some((circuit) => !circuit.is_owner) && <><h3 className={styles.circuitGroup}>Shared</h3>{circuits.filter((circuit) => !circuit.is_owner).map((circuit) => <button key={circuit.id} type="button" className={`${styles.gradeOption} ${circuit.id === activeCircuit?.id ? styles.gradeOptionSelected : ""}`} style={{ borderColor: circuit.id === activeCircuit?.id ? circuitColor(circuit.color) : undefined }} aria-pressed={circuit.id === activeCircuit?.id} onClick={() => updateCircuit(circuit.id)}><CircuitBadge circuit={circuit} /></button>)}</>}
          </div>
          <Link to={`/circuits?${new URLSearchParams({ wallId, gymSlug })}`}>Manage circuits</Link>
        </section>
      </FilterDrawer>
      <FilterDrawer open={sortOpen} title="Sort" onClose={() => setSortOpen(false)} onClear={() => updateSort("newest")} matchingCount={matchingRoutes.length} triggerRef={sortTriggerRef}>
        <div className={styles.gradeOptions} role="group" aria-label="Sort climbs">
          {(["newest", "grade_asc", "grade_desc"] as const).map((value) => {
            const label = value === "newest" ? "Newest" : value === "grade_asc" ? "Grade ↑" : "Grade ↓";
            return <button key={value} type="button" className={`${styles.gradeOption} ${sort === value ? styles.gradeOptionSelected : ""}`} aria-pressed={sort === value} onClick={() => updateSort(value)}>{label}</button>;
          })}
        </div>
      </FilterDrawer>
      {hasActiveFilters && matchingRoutes.length === 0 && (
        <div className={styles.noMatches} role="status">
          <span>{noMatchesMessage}</span>
          <button type="button" className="btn btn-ghost" onClick={clearFilters}>Clear all filters</button>
        </div>
      )}
      {matchingRoutes.length > 0 && (
        <ul className={styles.list}>
          {matchingRoutes.map((route) => {
            const linkParams = writeRouteSort(writeRouteFilters(new URLSearchParams(searchParams), filters), sort);
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
                    <div className={styles.routeName}>{activeCircuit ? `${activeCircuit.route_ids.indexOf(route.id) + 1}. ` : ""}{route.name}</div>
                    <div className={styles.routeMeta}>
                      {route.send_count} send{route.send_count !== 1 ? "s" : ""}
                      <span className={styles.metaSeparator}> · </span>
                      {route.hold_ids.length} hold{route.hold_ids.length !== 1 ? "s" : ""}
                      <span className={styles.metaSeparator}> · </span>
                      {route.rating_average == null ? "Unrated" : `★ ${route.rating_average.toFixed(1)} (${route.rating_count ?? 0})`}
                    </div>
                    <div className={styles.badges} role="group" aria-label="Route status and style tags">
                      {route.status === "draft" && <span className={`${styles.badge} ${styles.draftBadge}`}>Draft</span>}
                      {route.is_legacy && <span className={`${styles.badge} ${styles.resetBadge}`}>Reset</span>}
                      {route.progress === "projects" && !route.has_sent && <span className={`${styles.badge} ${styles.projectBadge}`}>Projects</span>}
                      {route.has_sent && <span className={`${styles.badge} ${styles.sentBadge}`}>Sent</span>}
                      {route.has_flashed && <span className={`${styles.badge} ${styles.flashBadge}`}>Flashed</span>}
                      <RouteTags tags={route.tags} compact />
                    </div>
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
