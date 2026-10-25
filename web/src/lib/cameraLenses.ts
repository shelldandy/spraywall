export type CameraLensLabel = "0.5x" | "1x" | "Tele";

const FRONT_KEYWORDS = ["front", "frontal", "delantera", "avant", "vorder", "anteriore"];
const VIRTUAL_KEYWORDS = ["dual", "triple", "doble", "dupla", "tripla", "doppel", "duale", "tripl"];
const REAR_KEYWORDS = [
  "back", "rear", "trasera", "trasero", "traseira", "traseiro", "posterior",
  "posteriore", "arriere", "ruck", "hinten", "dietro", "achter", "bakre", "bageste",
];

function normalizeName(name: string): string {
  return name.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

function includesKeyword(name: string, keywords: string[]): boolean {
  return keywords.some((keyword) => name.includes(keyword));
}

/** Classifies a physical rear camera without exposing localized device names in the UI. */
export function lensLabel(name: string): CameraLensLabel | null {
  const normalized = normalizeName(name);
  if (!normalized || includesKeyword(normalized, FRONT_KEYWORDS)) return null;
  // Virtual multi-camera devices choose lenses automatically and break overlay alignment.
  if (includesKeyword(normalized, VIRTUAL_KEYWORDS)) return null;
  if (normalized.includes("ultra")) return "0.5x";
  if (normalized.includes("tele")) return "Tele";
  return "1x";
}

/** Keeps an explicit rear camera when ambiguous labels would otherwise produce multiple 1x pills. */
export function filterAmbiguousWideLenses<T extends { label: CameraLensLabel; name: string }>(
  candidates: T[],
): T[] {
  const wideLenses = candidates.filter((lens) => lens.label === "1x");
  if (wideLenses.length <= 1) return candidates;

  const explicitlyRear = wideLenses.filter((lens) =>
    includesKeyword(normalizeName(lens.name), REAR_KEYWORDS),
  );
  const selected = explicitlyRear.length === 1 ? explicitlyRear[0] : undefined;
  return candidates.filter((lens) => lens.label !== "1x" || lens === selected);
}
