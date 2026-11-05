import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import {
  useLogbook,
  useHolds,
  useRoutes,
  useWallDetail,
} from "../lib/hooks/queries";
import { holdCoverage, personalStats } from "../lib/stats";
import { getVGradeRank } from "../lib/grades";
import {
  BarChart,
  CalendarHeatmap,
  HoldHeatmap,
  RankedList,
  StatTile,
} from "../components/Stats";
import styles from "./Stats.module.css";

export default function StatsPage() {
  const [params, setParams] = useSearchParams();
  const wallId = params.get("wallId") ?? undefined;
  const [selectedHoldId, setSelectedHoldId] = useState<string | null>(null);
  const logbook = useLogbook();
  const holds = useHolds(wallId ?? "", Boolean(wallId));
  const routes = useRoutes(wallId ?? "");
  const wall = useWallDetail(wallId ?? "");
  const stats = personalStats(logbook.data ?? [], wallId);
  const coverage = wallId
    ? holdCoverage(holds.data ?? [], routes.data ?? [])
    : null;
  const wallChoices = [
    ...new Map(
      (logbook.data ?? []).map((entry) => [entry.wall_id, entry.wall_name]),
    ).entries(),
  ].sort((a, b) => a[1].localeCompare(b[1]));
  const selectWall = (nextWallId?: string) => {
    const next = new URLSearchParams(params);
    if (nextWallId) next.set("wallId", nextWallId);
    else next.delete("wallId");
    setParams(next);
    setSelectedHoldId(null);
  };
  return (
    <div className={`screen ${styles.page}`}>
      <header className={`header ${styles.header}`}>
        <nav className={styles.tabs}>
          <Link
            to={`/logbook${wallId ? `?wallId=${encodeURIComponent(wallId)}` : ""}`}
          >
            Logbook
          </Link>
          <Link
            className={styles.active}
            to={`/stats${wallId ? `?wallId=${encodeURIComponent(wallId)}` : ""}`}
          >
            Stats
          </Link>
        </nav>
        <h1 className={styles.title}>Stats</h1>
        <span />
      </header>
      <main className={`content ${styles.content}`}>
        {logbook.isLoading ? (
          <div className={styles.loader}>
            <div className="spinner" />
          </div>
        ) : logbook.isError ? (
          <p className="error-text">{logbook.error.message}</p>
        ) : (
          <>
            <nav className={styles.wallPicker} aria-label="Choose stats wall">
              <button
                type="button"
                className={!wallId ? styles.wallSelected : ""}
                aria-pressed={!wallId}
                onClick={() => selectWall()}
              >
                All walls
              </button>
              {wallChoices.map(([id, name]) => (
                <button
                  type="button"
                  className={wallId === id ? styles.wallSelected : ""}
                  aria-pressed={wallId === id}
                  key={id}
                  onClick={() => selectWall(id)}
                >
                  {name}
                </button>
              ))}
            </nav>
            <div className={styles.grid}>
              <StatTile label="Sends" value={stats.totals.sends} />
              <StatTile label="Flashes" value={stats.totals.flashes} />
              <StatTile label="Attempts" value={stats.totals.attempts} />
              <StatTile
                label="Unique routes sent"
                value={stats.totals.unique_climbs_sent}
              />
              <StatTile
                label="Days climbed"
                value={stats.totals.days_climbed}
              />
              <StatTile
                label="Flash rate"
                value={`${Math.round(stats.totals.flash_rate * 100)}%`}
              />
              <StatTile
                label="Hardest send"
                value={stats.totals.hardest_send ?? "—"}
              />
              <StatTile
                label="Current streak"
                value={`${stats.streaks.current} weeks`}
              />
              <StatTile
                label="Longest streak"
                value={`${stats.streaks.longest} weeks`}
              />
            </div>
            <RankedList title="Sent routes by grade">
              <BarChart
                data={stats.pyramid.map((item) => ({
                  label: item.grade ?? "?",
                  grade: item.grade,
                  value: item.sends + item.flashes,
                }))}
                flashData={stats.pyramid.map((item) => item.flashes)}
                label="Routes sent"
              />
            </RankedList>
            <RankedList title="Hardest send by month">
              <BarChart
                label="Hardest grade progression"
                data={stats.hardest_by_month.map((item) => ({
                  label: item.month.slice(5),
                  value: item.grade ? (getVGradeRank(item.grade) ?? -1) + 1 : 0,
                  grade: item.grade,
                  valueLabel: item.grade ?? "—",
                }))}
              />
            </RankedList>
            <RankedList title="Climbing calendar (26 weeks)">
              <CalendarHeatmap data={stats.calendar} />
            </RankedList>
            {wallId && (
              <RankedList title="Wall hold coverage">
                <div className={styles.row}>
                  <span>
                    {holds.isLoading || routes.isLoading
                      ? "Loading coverage…"
                      : `${coverage?.covered ?? 0} touched / ${(coverage?.total ?? 0) - (coverage?.covered ?? 0)} never touched`}
                  </span>
                  <strong>
                    {coverage?.percentage === undefined
                      ? ""
                      : `${Math.round(coverage.percentage * 100)}%`}
                  </strong>
                </div>
                <HoldHeatmap
                  imageUrl={wall.data?.image?.image_url ?? null}
                  holds={holds.data ?? []}
                  stats={[]}
                  wallId={wallId}
                  touchedHoldIds={
                    new Set(
                      (coverage?.holds ?? [])
                        .filter((item) => item.covered)
                        .map((item) => item.hold_id),
                    )
                  }
                  selectedHoldId={selectedHoldId}
                  onSelectHold={setSelectedHoldId}
                />
              </RankedList>
            )}
          </>
        )}
      </main>
    </div>
  );
}
