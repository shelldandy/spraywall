export interface Grade {
  id: number;
  v: string;
  font: string;
  dankyu: string;
}

export type GradeSystem = "v" | "font" | "dankyu";

export interface GradeColorStyle {
  backgroundColor: string;
  color: string;
}

// Exact V-scale swatch colors from theCrag's bouldering grade systems table.
const vGradeColors: Record<string, GradeColorStyle> = {
  VB: { backgroundColor: "#54b41a", color: "#000" },
  V0: { backgroundColor: "#fee100", color: "#000" },
  V1: { backgroundColor: "#ed9f1d", color: "#000" },
  V2: { backgroundColor: "#e88d25", color: "#000" },
  V3: { backgroundColor: "#e37726", color: "#000" },
  V4: { backgroundColor: "#dd5e1f", color: "#000" },
  V5: { backgroundColor: "#d33113", color: "#fff" },
  V6: { backgroundColor: "#cf200f", color: "#fff" },
  V7: { backgroundColor: "#cb100b", color: "#fff" },
  V8: { backgroundColor: "#c70a11", color: "#fff" },
  V9: { backgroundColor: "#c30c20", color: "#fff" },
  V10: { backgroundColor: "#bf0f2f", color: "#fff" },
  V11: { backgroundColor: "#b41555", color: "#fff" },
  V12: { backgroundColor: "#b01865", color: "#fff" },
  V13: { backgroundColor: "#ac1a73", color: "#fff" },
  V14: { backgroundColor: "#ac1a7d", color: "#fff" },
  V15: { backgroundColor: "#b21882", color: "#fff" },
  V16: { backgroundColor: "#b81587", color: "#fff" },
  V17: { backgroundColor: "#c50f93", color: "#fff" },
};

export function getGradeColorStyle(grade: string): GradeColorStyle | undefined {
  return vGradeColors[grade.trim().toUpperCase()];
}

export const grades: Grade[] = [
  { id: 0,  v: "VB",  font: "1",    dankyu: "7 kyuu" },
  { id: 1,  v: "VB",  font: "2",    dankyu: "7 kyuu" },
  { id: 2,  v: "VB",  font: "3",    dankyu: "7 kyuu" },
  { id: 3,  v: "V0",  font: "4",    dankyu: "7 kyuu" },
  { id: 4,  v: "V0",  font: "4+",   dankyu: "6 kyuu" },
  { id: 5,  v: "V1",  font: "5",    dankyu: "5 kyuu" },
  { id: 6,  v: "V2",  font: "5+",   dankyu: "4 kyuu" },
  { id: 7,  v: "V2",  font: "6A",   dankyu: "4 kyuu" },
  { id: 8,  v: "V3",  font: "6A",   dankyu: "3 kyuu" },
  { id: 9,  v: "V3",  font: "6A+",  dankyu: "3 kyuu" },
  { id: 10, v: "V4",  font: "6B",   dankyu: "2 kyuu" },
  { id: 11, v: "V4",  font: "6B+",  dankyu: "2 kyuu" },
  { id: 12, v: "V5",  font: "6B+",  dankyu: "1 kyuu" },
  { id: 13, v: "V5",  font: "6C",   dankyu: "1 kyuu" },
  { id: 14, v: "V6",  font: "6C+",  dankyu: "1 kyuu" },
  { id: 15, v: "V6",  font: "7A",   dankyu: "1 kyuu" },
  { id: 16, v: "V7",  font: "7A",   dankyu: "1 kyuu" },
  { id: 17, v: "V7",  font: "7A+",  dankyu: "1 dan" },
  { id: 18, v: "V8",  font: "7B",   dankyu: "1 dan" },
  { id: 19, v: "V8",  font: "7B+",  dankyu: "2 dan" },
  { id: 20, v: "V9",  font: "7B+",  dankyu: "2 dan" },
  { id: 21, v: "V9",  font: "7C",   dankyu: "2 dan" },
  { id: 22, v: "V10", font: "7C+",  dankyu: "3 dan" },
  { id: 23, v: "V11", font: "8A",   dankyu: "3 dan" },
  { id: 24, v: "V12", font: "8A+",  dankyu: "4 dan" },
  { id: 25, v: "V13", font: "8B",   dankyu: "4 dan" },
  { id: 26, v: "V14", font: "8B+",  dankyu: "5 dan" },
  { id: 27, v: "V15", font: "8C",   dankyu: "5 dan" },
  { id: 28, v: "V16", font: "8C+",  dankyu: "5 dan" },
  { id: 29, v: "V17", font: "9A",   dankyu: "5 dan" },
];

export const gradeSystems: { label: string; value: GradeSystem }[] = [
  { label: "V/Hueco", value: "v" },
  { label: "Font", value: "font" },
  { label: "Dankyu", value: "dankyu" },
];

/** De-duplicate by V-grade for picker display: returns one entry per unique V-grade. */
export function uniqueVGrades(): Grade[] {
  const seen = new Set<string>();
  return grades.filter((g) => {
    if (seen.has(g.v)) return false;
    seen.add(g.v);
    return true;
  });
}

const vGradeRanks = new Map(uniqueVGrades().map(({ v }, rank) => [v, rank]));

/** Return a V-grade's rank on the canonical scale, or null for ungraded/unknown values. */
export function getVGradeRank(grade: unknown): number | null {
  if (typeof grade !== "string") return null;
  return vGradeRanks.get(grade.trim().toUpperCase()) ?? null;
}

/** Check an inclusive V-grade range. Without bounds, ungraded and unknown grades remain visible. */
export function isVGradeWithinRange(
  grade: string | null | undefined,
  minGrade: string | null = null,
  maxGrade: string | null = null,
): boolean {
  if (minGrade === null && maxGrade === null) return true;

  const rank = getVGradeRank(grade);
  if (rank === null) return false;

  const minRank = minGrade === null ? null : getVGradeRank(minGrade);
  const maxRank = maxGrade === null ? null : getVGradeRank(maxGrade);
  return (minRank === null || rank >= minRank) && (maxRank === null || rank <= maxRank);
}

/** Look up a grade by its ID. */
export function gradeById(id: number): Grade | undefined {
  return grades.find((g) => g.id === id);
}

/** Format a grade for display in the given system. */
export function formatGrade(gradeId: number, system: GradeSystem): string {
  const g = gradeById(gradeId);
  if (!g) return "?";
  return g[system];
}

/** Find a grade ID from a V-grade string (e.g. "V4" → 10). Returns first match. */
export function gradeIdFromV(v: string): number | null {
  const g = grades.find((g) => g.v === v);
  return g ? g.id : null;
}
