import { useState } from "react";
import { Link, useParams } from "react-router";
import { useWallStats, useWallDetail, useHolds } from "../lib/hooks/queries";
import {
  StatTile,
  BarChart,
  GradeStatsChart,
  HoldHeatmap,
  RankedList,
} from "../components/Stats";
import { gradeBuckets } from "../lib/stats";
import styles from "./Stats.module.css";
import visualStyles from "../components/Stats.module.css";

export default function WallStatsPage() {
  const { wallId = "" } = useParams();
  const [metric, setMetric] = useState<"climbs" | "ascents">("climbs");
  const [selectedHoldId, setSelectedHoldId] = useState<string | null>(null);
  const stats = useWallStats(wallId);
  const wall = useWallDetail(wallId);
  const holds = useHolds(wallId);
  if (stats.isLoading)
    return (
      <div className={styles.loader}>
        <div className="spinner" />
      </div>
    );
  if (stats.isError || !stats.data)
    return (
      <main className={`screen ${styles.page}`}>
        <p className="error-text">
          {stats.error?.message ?? "Stats unavailable"}
        </p>
      </main>
    );
  const data = stats.data;
  return (
    <div className={`screen ${styles.page}`}>
      <header className={`header ${styles.header}`}>
        <Link to={`/walls/${wallId}`} className="btn btn-ghost">
          Back
        </Link>
        <h1 className={styles.title}>{wall.data?.wall.name ?? "Wall stats"}</h1>
        <span />
      </header>
      <main className={`content ${styles.content}`}>
        <div className={styles.grid}>
          {Object.entries(data.totals).map(([label, value]) => (
            <StatTile
              key={label}
              label={label.replaceAll("_", " ")}
              value={value}
            />
          ))}
        </div>
        <RankedList title="Climbs by grade">
          <div className={visualStyles.chartLegend}>
            <span>
              <i className={visualStyles.climbLegend} /> Climbs set
            </span>
            <span>
              <i className={visualStyles.sendLegend} /> Sends
            </span>
            <span>
              <i className={visualStyles.flashLegend} /> Flashes
            </span>
          </div>
          <GradeStatsChart data={gradeBuckets(data.grades)} />
        </RankedList>
        <RankedList title="Wall holds">
          <div
            className={visualStyles.segmented}
            role="group"
            aria-label="Hold heatmap metric"
          >
            <button
              type="button"
              aria-pressed={metric === "climbs"}
              className={metric === "climbs" ? visualStyles.segmentActive : ""}
              onClick={() => setMetric("climbs")}
            >
              Climbs set
            </button>
            <button
              type="button"
              aria-pressed={metric === "ascents"}
              className={metric === "ascents" ? visualStyles.segmentActive : ""}
              onClick={() => setMetric("ascents")}
            >
              Ascents
            </button>
          </div>
          <p>{data.totals.unused_holds} unused holds</p>
          <div className={visualStyles.heatLegend}>
            <span>Less</span>
            <i className={visualStyles.heatOne} />
            <i className={visualStyles.heatTwo} />
            <i className={visualStyles.heatThree} />
            <i className={visualStyles.heatFour} />
            <span>More {metric}</span>
            <span className={visualStyles.deadKey}>
              Dashed outline = unused hold
            </span>
          </div>
          <HoldHeatmap
            imageUrl={wall.data?.image?.image_url ?? null}
            holds={holds.data ?? []}
            stats={data.holds}
            metric={metric}
            selectedHoldId={selectedHoldId}
            onSelectHold={setSelectedHoldId}
            wallId={wallId}
          />
        </RankedList>
        {data.weekly.length > 0 && (
          <RankedList title="Weekly activity">
            <p>Ascents</p>
            <BarChart
              label="Ascents"
              data={data.weekly.map((week) => ({
                label: week.week_start.slice(5),
                value: week.ascents,
              }))}
            />
            <p>Climbers</p>
            <BarChart
              label="Climbers"
              data={data.weekly.map((week) => ({
                label: week.week_start.slice(5),
                value: week.climbers,
              }))}
            />
          </RankedList>
        )}
        <RankedList title="Most repeated">
          <ol>
            {data.most_repeated.map((item) => (
              <li className={styles.row} key={item.route_id}>
                <Link
                  className={styles.link}
                  to={`/routes/${item.route_id}?${new URLSearchParams({ wallId })}`}
                >
                  {item.name} {item.grade}
                </Link>
                <span>{item.sends}</span>
              </li>
            ))}
          </ol>
        </RankedList>
        <RankedList title="Top rated">
          <ol>
            {data.top_rated.map((item) => (
              <li className={styles.row} key={item.route_id}>
                <Link
                  className={styles.link}
                  to={`/routes/${item.route_id}?${new URLSearchParams({ wallId })}`}
                >
                  {item.name} {item.grade}
                </Link>
                <span>
                  {item.rating_average.toFixed(1)} ({item.rating_count})
                </span>
              </li>
            ))}
          </ol>
        </RankedList>
        <RankedList title="Unsent routes">
          <ol>
            {data.unsent.map((item) => (
              <li className={styles.row} key={item.route_id}>
                <Link
                  className={styles.link}
                  to={`/routes/${item.route_id}?${new URLSearchParams({ wallId })}`}
                >
                  {item.name} {item.grade}
                </Link>
                <span>{item.created_at.slice(0, 10)}</span>
              </li>
            ))}
          </ol>
        </RankedList>
        <RankedList title="Setters">
          <BarChart
            label="Climbs by setter"
            data={data.setters.map((item) => ({
              label: item.display_name,
              value: item.climbs,
            }))}
          />
        </RankedList>
      </main>
    </div>
  );
}
