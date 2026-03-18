export interface Grade {
  id: number;
  v: string;
  font: string;
  dankyu: string;
}

export type GradeSystem = "v" | "font" | "dankyu";

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
