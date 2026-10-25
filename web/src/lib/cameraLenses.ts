export type CameraLensLabel = "0.5x" | "1x" | "Tele";

const FRONT_KEYWORDS = ["front", "frontal", "delantera", "avant", "vorder", "anteriore"];
const VIRTUAL_KEYWORDS = ["dual", "triple", "doble", "dupla", "tripla", "doppel", "duale", "tripl"];

function includesKeyword(name: string, keywords: string[]): boolean {
  return keywords.some((keyword) => name.includes(keyword));
}

/** Classifies a physical rear camera without exposing localized device names in the UI. */
export function lensLabel(name: string): CameraLensLabel | null {
  const normalized = name.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
  if (!normalized || includesKeyword(normalized, FRONT_KEYWORDS)) return null;
  // Virtual multi-camera devices choose lenses automatically and break overlay alignment.
  if (includesKeyword(normalized, VIRTUAL_KEYWORDS)) return null;
  if (normalized.includes("ultra")) return "0.5x";
  if (normalized.includes("tele")) return "Tele";
  return "1x";
}
