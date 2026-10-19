import { getVGradeRank, isVGradeWithinRange, uniqueVGrades } from "./grades.ts";
import { parseRouteTags, routeHasAnyTag, type RouteTagId } from "./routeTags.ts";
import type { Route } from "./api/types.ts";

export type ProgressFilter = "unsent" | "not_tried" | "projects" | "sent";
export interface RouteFilters {
  tags: RouteTagId[];
  minGrade: string | null;
  maxGrade: string | null;
  progress: ProgressFilter | null;
  minStars: number | null;
}

const validGrades = new Set(uniqueVGrades().map(({ v }) => v));
const progressValues = new Set<ProgressFilter>(["unsent", "not_tried", "projects", "sent"]);

function gradeBound(values: string[]): string | null {
  for (const value of values) {
    const normalized = value.trim().toUpperCase();
    if (validGrades.has(normalized)) return normalized;
  }
  return null;
}

export function parseRouteFilters(params: URLSearchParams): RouteFilters {
  const minGrade = gradeBound(params.getAll("minGrade"));
  let maxGrade = gradeBound(params.getAll("maxGrade"));
  if (minGrade !== null && maxGrade !== null && getVGradeRank(minGrade)! > getVGradeRank(maxGrade)!) maxGrade = null;
  const rawProgress = params.getAll("progress");
  const progress = rawProgress.find((value): value is ProgressFilter => progressValues.has(value as ProgressFilter)) ?? null;
  const rawStars = params.getAll("minStars");
  const parsedStars = rawStars.map(Number).find((value) => Number.isInteger(value) && value >= 1 && value <= 5);
  return { tags: parseRouteTags(params.getAll("tag")), minGrade, maxGrade, progress, minStars: parsedStars ?? null };
}

/** Replace only route filter keys and preserve unrelated navigation parameters. */
export function writeRouteFilters(params: URLSearchParams, filters: RouteFilters): URLSearchParams {
  params.delete("tag");
  for (const tag of parseRouteTags(filters.tags)) params.append("tag", tag);
  params.delete("minGrade");
  if (filters.minGrade) params.set("minGrade", filters.minGrade);
  params.delete("maxGrade");
  if (filters.maxGrade) params.set("maxGrade", filters.maxGrade);
  params.delete("progress");
  if (filters.progress) params.set("progress", filters.progress);
  params.delete("minStars");
  if (filters.minStars !== null && filters.minStars >= 1 && filters.minStars <= 5) params.set("minStars", String(filters.minStars));
  return params;
}

export function matchesRouteFilters(route: Route, filters: RouteFilters): boolean {
  const gradeMatches = isVGradeWithinRange(route.grade, filters.minGrade, filters.maxGrade);
  const styleMatches = routeHasAnyTag(route.tags, filters.tags);
  const progress = route.progress ?? (route.has_sent ? "sent" : "not_tried");
  const progressMatches = filters.progress === null
    || (filters.progress === "unsent" ? progress !== "sent"
      : filters.progress === "not_tried" ? progress === "not_tried"
        : progress === filters.progress);
  const stars = filters.minStars === null || (route.rating_average !== null && route.rating_average !== undefined && route.rating_average >= filters.minStars);
  return gradeMatches && styleMatches && progressMatches && stars;
}

export function hasRouteFilters(filters: RouteFilters): boolean {
  return filters.tags.length > 0 || filters.minGrade !== null || filters.maxGrade !== null
    || filters.progress !== null || filters.minStars !== null;
}
