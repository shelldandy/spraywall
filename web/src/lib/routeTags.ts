export const routeTags = [
  { id: "pumpy", label: "Pumpy" },
  { id: "crimpy", label: "Crimpy" },
  { id: "pinchy", label: "Pinchy" },
  { id: "slopey", label: "Slopey" },
  { id: "juggy", label: "Juggy" },
  { id: "powerful", label: "Powerful" },
  { id: "technical", label: "Technical" },
  { id: "balancy", label: "Balancy" },
  { id: "dynamic", label: "Dynamic" },
  { id: "static", label: "Static" },
  { id: "reachy", label: "Reachy" },
  { id: "compression", label: "Compression" },
] as const;

export type RouteTagId = (typeof routeTags)[number]["id"];

const routeTagIds = new Set<string>(routeTags.map(({ id }) => id));

export function isRouteTagId(value: unknown): value is RouteTagId {
  return typeof value === "string" && routeTagIds.has(value);
}

/** Parse untrusted or persisted tag data, ignoring unknown values and duplicates. */
export function parseRouteTags(value: unknown): RouteTagId[] {
  if (!Array.isArray(value)) return [];
  const found = new Set(value.filter(isRouteTagId));
  return routeTags.filter(({ id }) => found.has(id)).map(({ id }) => id);
}

/** Missing tags in routes restored from older offline caches are treated as empty. */
export function routeHasAnyTag(routeTagsValue: unknown, selectedTags: readonly RouteTagId[]): boolean {
  if (selectedTags.length === 0) return true;
  const tags = new Set(parseRouteTags(routeTagsValue));
  return selectedTags.some((tag) => tags.has(tag));
}
