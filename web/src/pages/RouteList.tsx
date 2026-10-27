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
import { applyCircuit, parseRouteFilters, writeRouteFilters, matchesRouteFilters, hasRouteFilters, type ProgressFilter } from "../lib/routeFilters";
import type { RouteTagId } from "../lib/routeTags";
import styles from "./RouteList.module.css";

const progressChoices: { value: ProgressFilter; label: string }[] = [
  { value: "unsent", label: "Unsent" },
  { value: "not_tried", label: "Not tried" },
  { value: "projects", label: "Projects" },
  { value: "sent", label: "Sent" },
];

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
  const [gradePickerOpen, setGradePickerOpen] = useState(false);
  const [progressPickerOpen, setProgressPickerOpen] = useState(false);
  const [starsPickerOpen, setStarsPickerOpen] = useState(false);
  const [circuitPickerOpen, setCircuitPickerOpen] = useState(false);
  const gradeTriggerRef = useRef<HTMLButtonElement>(null);
  const progressTriggerRef = useRef<HTMLButtonElement>(null);
  const starsTriggerRef = useRef<HTMLButtonElement>(null);
  const circuitTriggerRef = useRef<HTMLButtonElement>(null);
  const filters = parseRouteFilters(searchParams);
  const { tags: selectedTags, minGrade, maxGrade, progress, minStars } = filters;
  const minRank = minGrade === null ? null : getVGradeRank(minGrade);
  const gradeOptions = uniqueVGrades();
  const hasGradeFilter = minGrade !== null || maxGrade !== null;

  useEffect(() => {
    const currentFilters = parseRouteFilters(searchParams);
    const canonical = writeRouteFilters(new URLSearchParams(searchParams), currentFilters);
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
  const matchingRoutes = circuitRoutes.filter((route) => matchesRouteFilters(route, filters));
  const hasActiveFilters = hasRouteFilters(filters);
  const updateFilters = (next: Partial<typeof filters>) => {
    const nextParams = writeRouteFilters(new URLSearchParams(searchParams), { ...filters, ...next });
    setSearchParams(nextParams, { replace: true });
  };
  const updateTags = (tags: readonly RouteTagId[]) => updateFilters({ tags: [...tags] });
  const clearFilters = () => {
    const nextParams = writeRouteFilters(new URLSearchParams(searchParams), { ...filters, tags: [], minGrade: null, maxGrade: null, progress: null, minStars: null, circuit: null });
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
  const gradeSummary = minGrade !== null && maxGrade !== null
    ? minGrade === maxGrade ? minGrade : `${minGrade}–${maxGrade}`
    : minGrade !== null ? `${minGrade}+` : maxGrade !== null ? `≤${maxGrade}` : "Grade";
  const progressLabel = progressChoices.find((choice) => choice.value === progress)?.label ?? "All";
  const starsLabel = minStars === null ? "Any" : `${minStars}+`;
  const noMatchesMessage = "No routes match these filters";

  return (
    <>
      <div className={styles.filterToolbar}>
        <RouteTagPicker
          selectedTags={selectedTags}
          onChange={updateTags}
          label="Style"
          compact
          helperText="Matches any selected tag"
          matchingCount={matchingRoutes.length}
        />
        <button
          ref={gradeTriggerRef}
          type="button"
          className={`${styles.gradeToggle} ${hasGradeFilter ? styles.gradeToggleActive : ""}`}
          aria-expanded={gradePickerOpen}
          onClick={() => setGradePickerOpen(true)}
        >
          {hasGradeFilter && <span aria-hidden="true">✓</span>}{gradeSummary}
        </button>
        <button ref={progressTriggerRef} type="button" className={`${styles.gradeToggle} ${progress ? styles.gradeToggleActive : ""}`} aria-expanded={progressPickerOpen} onClick={() => setProgressPickerOpen(true)}>
          {progress && <span aria-hidden="true">✓</span>}Progress: {progressLabel}
        </button>
        <button ref={starsTriggerRef} type="button" className={`${styles.gradeToggle} ${minStars !== null ? styles.gradeToggleActive : ""}`} aria-expanded={starsPickerOpen} onClick={() => setStarsPickerOpen(true)}>
          {minStars !== null && <span aria-hidden="true">✓</span>}Community: {starsLabel}
        </button>
        <button ref={circuitTriggerRef} type="button" className={`${styles.gradeToggle} ${activeCircuit ? styles.gradeToggleActive : ""}`} style={activeCircuit ? { borderColor: circuitColor(activeCircuit.color), backgroundColor: `color-mix(in srgb, ${circuitColor(activeCircuit.color)} 20%, var(--bg-muted))` } : undefined} onClick={() => setCircuitPickerOpen(true)}>Circuit: {activeCircuit ? `${activeCircuit.emoji} ${activeCircuit.name}` : "Any"}</button>
        {hasActiveFilters && <button type="button" className={`${styles.gradeToggle} ${styles.clearAllToggle}`} onClick={clearFilters}>Clear all</button>}
      </div>
      <FilterDrawer open={gradePickerOpen} title="Grade" onClose={() => setGradePickerOpen(false)} onClear={() => updateFilters({ minGrade: null, maxGrade: null })} matchingCount={matchingRoutes.length} triggerRef={gradeTriggerRef}>
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
      </FilterDrawer>
      <FilterDrawer open={progressPickerOpen} title="Personal progress" onClose={() => setProgressPickerOpen(false)} onClear={() => updateFilters({ progress: null })} matchingCount={matchingRoutes.length} triggerRef={progressTriggerRef}>
        <div className={styles.gradeOptions} role="group" aria-label="Filter by personal progress">
          <button type="button" className={`${styles.gradeOption} ${progress === null ? styles.gradeOptionAnySelected : ""}`} aria-pressed={progress === null} onClick={() => updateFilters({ progress: null })}>All</button>
          {progressChoices.map(({ value, label }) => <button key={value} type="button" className={`${styles.gradeOption} ${progress === value ? styles.gradeOptionSelected : ""}`} aria-pressed={progress === value} onClick={() => updateFilters({ progress: value })}>{label}</button>)}
        </div>
      </FilterDrawer>
      <FilterDrawer open={circuitPickerOpen} title="Circuit" onClose={() => setCircuitPickerOpen(false)} onClear={() => updateCircuit(null)} matchingCount={matchingRoutes.length} triggerRef={circuitTriggerRef}>
        <div className={styles.circuitChoices} role="group" aria-label="Filter by circuit">
          <button type="button" className={`${styles.gradeOption} ${!activeCircuit ? styles.gradeOptionAnySelected : ""}`} onClick={() => updateCircuit(null)}>Any</button>
          {circuits.some((circuit) => circuit.is_owner) && <><h3 className={styles.circuitGroup}>Yours</h3>{circuits.filter((circuit) => circuit.is_owner).map((circuit) => <button key={circuit.id} type="button" className={`${styles.gradeOption} ${circuit.id === activeCircuit?.id ? styles.gradeOptionSelected : ""}`} style={{ borderColor: circuit.id === activeCircuit?.id ? circuitColor(circuit.color) : undefined }} aria-pressed={circuit.id === activeCircuit?.id} onClick={() => updateCircuit(circuit.id)}><CircuitBadge circuit={circuit} /></button>)}</>}
          {circuits.some((circuit) => !circuit.is_owner) && <><h3 className={styles.circuitGroup}>Shared</h3>{circuits.filter((circuit) => !circuit.is_owner).map((circuit) => <button key={circuit.id} type="button" className={`${styles.gradeOption} ${circuit.id === activeCircuit?.id ? styles.gradeOptionSelected : ""}`} style={{ borderColor: circuit.id === activeCircuit?.id ? circuitColor(circuit.color) : undefined }} aria-pressed={circuit.id === activeCircuit?.id} onClick={() => updateCircuit(circuit.id)}><CircuitBadge circuit={circuit} /></button>)}</>}
        </div>
        <Link to={`/circuits?${new URLSearchParams({ wallId, gymSlug })}`}>Manage circuits</Link>
      </FilterDrawer>
      <FilterDrawer open={starsPickerOpen} title="Community ratings" onClose={() => setStarsPickerOpen(false)} onClear={() => updateFilters({ minStars: null })} matchingCount={matchingRoutes.length} triggerRef={starsTriggerRef}>
        <p className={styles.gradeHelper}>Minimum unrounded community average. Unrated climbs appear under Any.</p>
        <div className={styles.gradeOptions} role="group" aria-label="Minimum community rating">
          <button type="button" className={`${styles.gradeOption} ${minStars === null ? styles.gradeOptionAnySelected : ""}`} aria-pressed={minStars === null} onClick={() => updateFilters({ minStars: null })}>Any</button>
          {[1, 2, 3, 4, 5].map((stars) => <button key={stars} type="button" className={`${styles.gradeOption} ${minStars === stars ? styles.gradeOptionSelected : ""}`} aria-pressed={minStars === stars} onClick={() => updateFilters({ minStars: stars })}>{stars === 5 ? "5" : `${stars}+`} ★</button>)}
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
            const linkParams = writeRouteFilters(new URLSearchParams(searchParams), filters);
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
                      <RouteTags tags={route.tags} compact maxVisible={2} />
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
