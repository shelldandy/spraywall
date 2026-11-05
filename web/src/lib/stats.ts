import { getVGradeRank } from "./grades.ts";
import type { ClimbLog, Hold, LogbookEntry, Route } from "./api/types";

export function heatColor(value: number, max = 4): string {
  if (value <= 0) return "var(--bg-muted)";
  const level = Math.min(4, Math.ceil((value / Math.max(max, 1)) * 4));
  return [
    "var(--accent-soft)",
    "var(--success-bg)",
    "var(--success)",
    "var(--accent)",
  ][level - 1];
}

export function gradeBuckets<T extends { grade: string | null }>(
  rows: T[],
): T[] {
  return [...rows].sort((a, b) => {
    const aRank = getVGradeRank(a.grade);
    const bRank = getVGradeRank(b.grade);
    if (aRank === null) return bRank === null ? 0 : 1;
    if (bRank === null) return -1;
    return aRank - bRank;
  });
}

export interface PersonalStats {
  totals: {
    sends: number;
    flashes: number;
    attempts: number;
    unique_climbs_sent: number;
    days_climbed: number;
    flash_rate: number;
    hardest_send: string | null;
  };
  pyramid: { grade: string | null; sends: number; flashes: number }[];
  hardest_by_month: { month: string; grade: string | null }[];
  calendar: { date: string; count: number }[];
  streaks: { current: number; longest: number };
}

const dateKey = (date: Date) => date.toISOString().slice(0, 10);
const weekStart = (date: Date) => {
  const result = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  result.setUTCDate(result.getUTCDate() - ((result.getUTCDay() + 6) % 7));
  return result;
};

export function personalStats(
  entries: LogbookEntry[] | ClimbLog[],
  wallId?: string,
  now = new Date(),
): PersonalStats {
  const filtered = entries.filter(
    (entry) => !("wall_id" in entry) || !wallId || entry.wall_id === wallId,
  );
  const sent = filtered.filter(
    (entry) => entry.outcome === "send" || entry.outcome === "flash",
  );
  const sentRoutes = new Map<
    string,
    { grade: string | null; flash: boolean }
  >();
  for (const entry of sent) {
    const current = sentRoutes.get(entry.route_id);
    sentRoutes.set(entry.route_id, {
      grade: (entry as Partial<LogbookEntry>).route_grade ?? null,
      flash: (current?.flash ?? false) || entry.outcome === "flash",
    });
  }
  const pyramid = gradeBuckets(
    [...new Set([...sentRoutes.values()].map((route) => route.grade))].map(
      (grade) => {
        const routes = [...sentRoutes.values()].filter(
          (route) => route.grade === grade,
        );
        const flashes = routes.filter((route) => route.flash).length;
        return { grade, sends: routes.length - flashes, flashes };
      },
    ),
  );
  const monthStart = new Date(
    Date.UTC(now.getFullYear(), now.getMonth() - 11, 1),
  );
  const monthly = new Map<string, string | null>();
  for (let i = 0; i < 12; i++)
    monthly.set(
      dateKey(
        new Date(
          Date.UTC(
            monthStart.getUTCFullYear(),
            monthStart.getUTCMonth() + i,
            1,
          ),
        ),
      ).slice(0, 7),
      null,
    );
  for (const entry of sent) {
    const month = entry.climbed_on.slice(0, 7);
    if (!monthly.has(month)) continue;
    const grade = (entry as Partial<LogbookEntry>).route_grade ?? null;
    const previous = monthly.get(month);
    if (
      previous === undefined ||
      previous === null ||
      (getVGradeRank(grade) ?? -1) > (getVGradeRank(previous) ?? -1)
    )
      monthly.set(month, grade);
  }
  const today = new Date(
    Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()),
  );
  const calendarStart = weekStart(today);
  calendarStart.setUTCDate(calendarStart.getUTCDate() - 25 * 7);
  const days = new Map(filtered.map((entry) => [entry.climbed_on, 0]));
  for (const entry of filtered)
    days.set(entry.climbed_on, (days.get(entry.climbed_on) ?? 0) + 1);
  const calendar = Array.from({ length: 182 }, (_, i) => {
    const date = new Date(calendarStart);
    date.setUTCDate(calendarStart.getUTCDate() + i);
    const key = dateKey(date);
    return { date: key, count: days.get(key) ?? 0 };
  });
  const weekCounts = new Map<string, number>();
  for (const entry of filtered) {
    const week = dateKey(weekStart(new Date(`${entry.climbed_on}T00:00:00Z`)));
    weekCounts.set(week, (weekCounts.get(week) ?? 0) + 1);
  }
  let longest = 0,
    run = 0;
  const activeWeeks = [...weekCounts.keys()].sort();
  let previousWeek: Date | null = null;
  for (const key of activeWeeks) {
    const current = new Date(`${key}T00:00:00Z`);
    run =
      previousWeek &&
      current.getTime() - previousWeek.getTime() === 7 * 86400000
        ? run + 1
        : 1;
    longest = Math.max(longest, run);
    previousWeek = current;
  }
  let current = 0;
  let cursor = weekStart(today);
  while (weekCounts.has(dateKey(cursor))) {
    current++;
    cursor.setUTCDate(cursor.getUTCDate() - 7);
  }
  const flashes = filtered.filter((e) => e.outcome === "flash").length;
  const sends = filtered.filter((e) => e.outcome === "send").length;
  const totalSends = sends + flashes;
  const rankOrdered = [...sentRoutes.values()]
    .map((route) => route.grade)
    .filter((grade): grade is string => grade !== null)
    .sort((a, b) => (getVGradeRank(b) ?? -1) - (getVGradeRank(a) ?? -1));
  return {
    totals: {
      sends,
      flashes,
      attempts: filtered.filter((e) => e.outcome === "attempt").length,
      unique_climbs_sent: sentRoutes.size,
      days_climbed: new Set(filtered.map((e) => e.climbed_on)).size,
      flash_rate: totalSends ? flashes / totalSends : 0,
      hardest_send: rankOrdered[0] ?? null,
    },
    pyramid,
    hardest_by_month: [...monthly].map(([month, grade]) => ({ month, grade })),
    calendar,
    streaks: { current, longest },
  };
}

export function holdCoverage(holds: Hold[], routes: Route[]) {
  const sent = routes.filter((route) => route.has_sent);
  const used = new Set(
    sent.flatMap((route) => route.active_hold_ids ?? route.hold_ids),
  );
  const coveredHolds = holds.map((hold) => ({
    hold_id: hold.id,
    covered: used.has(hold.id),
  }));
  const covered = coveredHolds.filter((hold) => hold.covered).length;
  return {
    holds: coveredHolds,
    covered,
    total: holds.length,
    percentage: holds.length ? covered / holds.length : 0,
  };
}
