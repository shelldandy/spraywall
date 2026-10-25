export type HoldColor = "kept" | "new" | "removed";

/** Shared by ResetDiffOverlay and the review legend so they never drift apart. */
export const resetHoldColors: Record<HoldColor, { fill: string; stroke: string }> = {
  kept: { fill: "rgba(0, 200, 83, 0.3)", stroke: "#00c853" },
  new: { fill: "rgba(0, 176, 255, 0.3)", stroke: "#00b0ff" },
  removed: { fill: "rgba(255, 23, 68, 0.3)", stroke: "#ff1744" },
};
