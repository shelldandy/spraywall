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

export function deriveProgress(outcomes: readonly ClimbOutcome[]): PersonalProgress {
  if (outcomes.some((outcome) => outcome === "send" || outcome === "flash")) return "sent";
  return outcomes.includes("attempt") ? "projects" : "not_tried";
}

export function canFlash(outcomes: readonly ClimbOutcome[]): boolean {
  return outcomes.length === 0;
}
