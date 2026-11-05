import { useState, type KeyboardEvent, type ReactNode } from "react";
import { Link } from "react-router";
import type { Hold, WallStats } from "../lib/api/types";
import { getGradeColorStyle } from "../lib/grades";
import { heatColor } from "../lib/stats";
import WallImage from "./WallImage";
import styles from "./Stats.module.css";

export function StatTile({
  label,
  value,
}: {
  label: string;
  value: ReactNode;
}) {
  return (
    <div className={styles.tile}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export function BarChart({
  data,
  label = "",
  flashData = [],
}: {
  data: {
    label: string;
    value: number;
    grade?: string | null;
    valueLabel?: string;
  }[];
  label?: string;
  flashData?: number[];
}) {
  const max = Math.max(1, ...data.map((item) => item.value));
  return (
    <div className={styles.bars} aria-label={label}>
      {data.map((item, i) => (
        <div className={styles.barRow} key={`${item.label}-${i}`}>
          <span
            className={styles.barLabel}
            style={item.grade ? getGradeColorStyle(item.grade) : undefined}
          >
            {item.label}
          </span>
          <div className={styles.barTrack}>
            <div
              className={styles.barFill}
              style={{
                width: `${(Math.max(0, item.value - (flashData[i] ?? 0)) / max) * 100}%`,
              }}
            />
            <div
              className={styles.barFlash}
              style={{
                left: `${(Math.max(0, item.value - (flashData[i] ?? 0)) / max) * 100}%`,
                width: `${((flashData[i] ?? 0) / max) * 100}%`,
              }}
            />
          </div>
          <b>{item.valueLabel ?? item.value}</b>
        </div>
      ))}
    </div>
  );
}

export function GradeStatsChart({ data }: { data: WallStats["grades"] }) {
  const max = Math.max(
    1,
    ...data.flatMap((row) => [row.climbs, row.sends + row.flashes]),
  );
  return (
    <div
      className={styles.gradeChart}
      aria-label="Climbs set and sends by grade"
    >
      {data.map((row) => {
        const sentTotal = row.sends + row.flashes;
        const flash = row.flashes;
        const send = row.sends;
        return (
          <div className={styles.gradeColumn} key={row.grade ?? "ungraded"}>
            <div className={styles.pairedBars}>
              <div
                className={styles.gradeBar}
                title={`Climbs set: ${row.climbs}`}
                style={{
                  height: `${Math.max(row.climbs ? 3 : 0, (row.climbs / max) * 100)}%`,
                }}
              />
              <div
                className={styles.gradeBarStack}
                title={`Sends: ${send}, flashes: ${flash}`}
                style={{
                  height: `${Math.max(sentTotal ? 3 : 0, (sentTotal / max) * 100)}%`,
                }}
              >
                <i
                  style={{
                    height: `${sentTotal ? (send / sentTotal) * 100 : 0}%`,
                  }}
                />
                <b
                  style={{
                    height: `${sentTotal ? (flash / sentTotal) * 100 : 0}%`,
                  }}
                />
              </div>
            </div>
            <span
              className={styles.gradeLabel}
              style={row.grade ? getGradeColorStyle(row.grade) : undefined}
            >
              {row.grade ?? "?"}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function CalendarHeatmap({
  data,
}: {
  data: { date: string; count: number }[];
}) {
  const max = Math.max(1, ...data.map((item) => item.count));
  return (
    <svg
      className={styles.calendar}
      viewBox="0 0 26 7"
      role="img"
      aria-label="Activity over 26 weeks"
      preserveAspectRatio="xMinYMin meet"
    >
      {data.slice(0, 182).map((item, index) => (
        <rect
          key={item.date}
          x={Math.floor(index / 7)}
          y={index % 7}
          width="0.82"
          height="0.82"
          rx="0.12"
          fill={heatColor(item.count, max)}
        >
          <title>
            {item.date}: {item.count}
          </title>
        </rect>
      ))}
    </svg>
  );
}

export function HoldHeatmap({
  imageUrl,
  holds,
  stats,
  wallId,
  metric = "climbs",
  selectedHoldId,
  onSelectHold,
  touchedHoldIds,
}: {
  imageUrl: string | null;
  holds: Hold[];
  stats: WallStats["holds"];
  wallId: string;
  metric?: "climbs" | "ascents";
  selectedHoldId?: string | null;
  onSelectHold?: (holdId: string | null) => void;
  touchedHoldIds?: ReadonlySet<string>;
}) {
  const [aspectRatio, setAspectRatio] = useState<number>();
  const statsByHold = new Map(stats.map((item) => [item.hold_id, item]));
  const values = holds.map(
    (hold) =>
      statsByHold.get(hold.id)?.[metric] ??
      (touchedHoldIds?.has(hold.id) ? 1 : 0),
  );
  const max = Math.max(1, ...values);
  const selected = holds.find((hold) => hold.id === selectedHoldId);
  const selectedStats = selected ? statsByHold.get(selected.id) : undefined;
  const selectedTouched = selected
    ? touchedHoldIds?.has(selected.id)
    : undefined;
  if (!imageUrl) return <p>No active wall image.</p>;
  return (
    <div className={styles.holdHeatmap}>
      {touchedHoldIds && (
        <p className={styles.coverageLegend}>
          Filled holds are touched by a sent route; dashed outlines are never
          touched.
        </p>
      )}
      <div className={styles.wallImage}>
        <WallImage src={imageUrl} onAspectRatioChange={setAspectRatio}>
          {aspectRatio && (
            <svg
              className={styles.holdSvg}
              viewBox={`0 0 ${aspectRatio} 1`}
              preserveAspectRatio="xMidYMid meet"
            >
              {holds.map((hold, index) => {
                const value = values[index];
                const isSelected = hold.id === selectedHoldId;
                const unused = touchedHoldIds
                  ? !touchedHoldIds.has(hold.id)
                  : (statsByHold.get(hold.id)?.climbs ?? 0) === 0;
                const valueLabel = touchedHoldIds
                  ? unused
                    ? "Never touched"
                    : "Touched"
                  : `${value} ${metric}`;
                const common = {
                  fill: heatColor(value, max),
                  stroke: isSelected
                    ? "var(--accent)"
                    : unused
                      ? "var(--text-faint)"
                      : "var(--text)",
                  strokeWidth: isSelected ? 3 : 1.5,
                  vectorEffect: "non-scaling-stroke" as const,
                  className: `${styles.holdShape} ${isSelected ? styles.selectedHold : ""} ${unused ? styles.unusedHold : ""}`,
                  role: "button" as const,
                  tabIndex: 0,
                  "aria-label": `${valueLabel} on hold ${hold.id}`,
                  onClick: () => onSelectHold?.(hold.id),
                  onKeyDown: (event: KeyboardEvent<SVGElement>) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onSelectHold?.(hold.id);
                    }
                  },
                };
                if (hold.polygon?.length)
                  return (
                    <polygon
                      key={hold.id}
                      points={hold.polygon
                        .map(([x, y]) => `${x * aspectRatio},${y}`)
                        .join(" ")}
                      {...common}
                    >
                      <title>{valueLabel}</title>
                    </polygon>
                  );
                return (
                  <rect
                    key={hold.id}
                    x={hold.bbox.x * aspectRatio}
                    y={hold.bbox.y}
                    width={hold.bbox.w * aspectRatio}
                    height={hold.bbox.h}
                    {...common}
                  >
                    <title>{valueLabel}</title>
                  </rect>
                );
              })}
            </svg>
          )}
        </WallImage>
      </div>
      {selected && (
        <div className={styles.holdSheet}>
          <div>
            <strong>
              {selectedTouched === undefined
                ? `${selectedStats?.[metric] ?? 0} ${metric}`
                : selectedTouched
                  ? "Touched"
                  : "Never touched"}
            </strong>
            <button
              type="button"
              className={styles.sheetClose}
              onClick={() => onSelectHold?.(null)}
              aria-label="Close hold details"
            >
              ×
            </button>
          </div>
          {selectedStats && (
            <p>
              {selectedStats.climbs} climbs · {selectedStats.ascents} ascents ·{" "}
              {selectedStats.start} starts · {selectedStats.finish} finishes ·{" "}
              {selectedStats.foot} foot
            </p>
          )}
          <Link
            to={`/walls/${wallId}?holdId=${encodeURIComponent(selected.id)}`}
          >
            Show routes using this hold
          </Link>
        </div>
      )}
      {!touchedHoldIds && (
        <div className={styles.topHolds}>
          <strong>Top 10 used holds by {metric}</strong>
          <ol>
            {[...holds]
              .filter((hold) => (statsByHold.get(hold.id)?.[metric] ?? 0) > 0)
              .sort(
                (a, b) =>
                  (statsByHold.get(b.id)?.[metric] ?? 0) -
                  (statsByHold.get(a.id)?.[metric] ?? 0),
              )
              .slice(0, 10)
              .map((hold) => (
                <li key={hold.id}>
                  <button
                    type="button"
                    onClick={() => onSelectHold?.(hold.id)}
                    aria-pressed={hold.id === selectedHoldId}
                  >
                    {statsByHold.get(hold.id)?.[metric] ?? 0} {metric}
                  </button>
                </li>
              ))}
          </ol>
        </div>
      )}
    </div>
  );
}

export function RankedList({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className={styles.section}>
      <h2>{title}</h2>
      {children}
    </section>
  );
}
