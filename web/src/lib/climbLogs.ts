export type ClimbOutcome = "attempt" | "send" | "flash";
export type PersonalProgress = "not_tried" | "projects" | "sent";

/** A date input is a local calendar date; never parse it through Date/UTC. */
export function localCalendarDate(now = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function formatCalendarDate(date: string, locale?: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return date;
  return new Intl.DateTimeFormat(locale, { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" })
    .format(new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))));
}

export interface CalendarDateParts {
  weekday: string;
  day: string;
  month: string;
}

function utcCalendarDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month, day);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month || date.getUTCDate() !== day) return null;
  return date;
}

export function calendarParts(date: string, locale?: string): CalendarDateParts {
  const parsed = utcCalendarDate(date);
  if (!parsed) return { weekday: "", day: date, month: "" };
  const parts = new Intl.DateTimeFormat(locale, {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).formatToParts(parsed);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return { weekday: value("weekday"), day: value("day"), month: value("month") };
}

export function formatRelativeTime(iso: string, now = new Date(), locale?: string): string {
  const dateOnly = utcCalendarDate(iso);
  const target = dateOnly ?? new Date(iso);
  if (Number.isNaN(target.getTime())) return iso;

  const relative = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (!dateOnly) {
    const seconds = (target.getTime() - now.getTime()) / 1000;
    const absoluteSeconds = Math.abs(seconds);
    const units: [Intl.RelativeTimeFormatUnit, number, number][] = [
      ["second", 1, 60],
      ["minute", 60, 60 * 60],
      ["hour", 60 * 60, 24 * 60 * 60],
      ["day", 24 * 60 * 60, 7 * 24 * 60 * 60],
      ["week", 7 * 24 * 60 * 60, 30 * 24 * 60 * 60],
      ["month", 30 * 24 * 60 * 60, 365 * 24 * 60 * 60],
      ["year", 365 * 24 * 60 * 60, Number.POSITIVE_INFINITY],
    ];
    const [unit, secondsPerUnit] = units.find(([, , upperBound]) => absoluteSeconds < upperBound) ?? units.at(-1)!;
    return relative.format(Math.round(seconds / secondsPerUnit), unit);
  }

  const dayMs = 24 * 60 * 60 * 1000;
  const days = Math.round((Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), target.getUTCDate()) -
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())) / dayMs);
  const absoluteDays = Math.abs(days);
  if (absoluteDays < 7) return relative.format(days, "day");
  if (absoluteDays < 30) return relative.format(Math.round(days / 7), "week");
  if (absoluteDays < 365) return relative.format(Math.round(days / 30), "month");
  return relative.format(Math.round(days / 365), "year");
}

export function deriveProgress(outcomes: readonly ClimbOutcome[]): PersonalProgress {
  if (outcomes.some((outcome) => outcome === "send" || outcome === "flash")) return "sent";
  return outcomes.includes("attempt") ? "projects" : "not_tried";
}

export function canFlash(outcomes: readonly ClimbOutcome[]): boolean {
  return outcomes.length === 0;
}
