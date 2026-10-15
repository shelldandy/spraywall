import type { MouseEvent } from "react";
import type { Hold, HoldRoles } from "../lib/api/types";

interface HoldOverlayProps {
  holds: Hold[];
  selectedIds: Set<string>;
  onToggle: (holdId: string) => void;
  mode?: "select" | "view" | "edit";
  holdRoles?: HoldRoles | null;
  editHoldMode?: "delete" | "add";
  holdToDelete?: string | null;
  /** Called with coordinates normalised to 0..1 when the image (not a hold) is clicked in add mode. */
  onBackgroundPress?: (normalizedX: number, normalizedY: number) => void;
}

function getHoldColor(
  holdId: string,
  isSelected: boolean,
  holdRoles?: HoldRoles | null,
  mode?: "select" | "view" | "edit",
  holdToDelete?: string | null,
) {
  if (holdToDelete === holdId)
    return { fill: "rgba(255, 0, 0, 0.5)", stroke: "#FF0000" };

  if (!isSelected)
    return mode === "view"
      ? { fill: "rgba(255, 255, 255, 0.15)", stroke: "rgba(255, 255, 255, 0.2)" }
      : { fill: "rgba(255, 255, 255, 0.25)", stroke: "#FFFFFF" };

  if (holdRoles) {
    if (holdRoles.start.includes(holdId))
      return { fill: "rgba(0, 200, 0, 0.4)", stroke: "#00CC00" };
    if (holdRoles.finish.includes(holdId))
      return { fill: "rgba(255, 50, 50, 0.4)", stroke: "#FF3333" };
  }

  return { fill: "rgba(0, 255, 255, 0.35)", stroke: "#00FFFF" };
}

/**
 * SVG layer drawn over a wall image. Hold coordinates are normalised (0..1), so the
 * overlay uses a unit viewBox stretched over its parent, which must be `position: relative`
 * and sized to the image (see WallImage).
 */
export default function HoldOverlay({
  holds,
  selectedIds,
  onToggle,
  mode = "select",
  holdRoles,
  editHoldMode,
  holdToDelete,
  onBackgroundPress,
}: HoldOverlayProps) {
  const handleBackgroundClick = (evt: MouseEvent<SVGRectElement>) => {
    // The rect's client rect includes any zoom transform, so this stays correct when zoomed.
    const bounds = evt.currentTarget.getBoundingClientRect();
    const normX = (evt.clientX - bounds.left) / bounds.width;
    const normY = (evt.clientY - bounds.top) / bounds.height;
    onBackgroundPress?.(normX, normY);
  };

  return (
    <svg
      viewBox="0 0 1 1"
      preserveAspectRatio="none"
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
    >
      {mode === "view" && <rect x={0} y={0} width={1} height={1} fill="rgba(0, 0, 0, 0.5)" />}
      {mode === "edit" && editHoldMode === "add" && (
        <rect
          x={0}
          y={0}
          width={1}
          height={1}
          fill="transparent"
          style={{ cursor: "crosshair" }}
          onClick={handleBackgroundClick}
        />
      )}
      {holds.map((hold) => {
        const isSelected = selectedIds.has(hold.id);
        const colors = getHoldColor(hold.id, isSelected, holdRoles, mode, holdToDelete);
        const common = {
          fill: colors.fill,
          stroke: colors.stroke,
          strokeWidth: 2,
          vectorEffect: "non-scaling-stroke" as const,
          style: { cursor: "pointer" },
          onClick: (e: MouseEvent) => {
            e.stopPropagation();
            onToggle(hold.id);
          },
        };

        if (hold.polygon && hold.polygon.length > 0) {
          const points = hold.polygon.map(([px, py]) => `${px},${py}`).join(" ");
          return <polygon key={hold.id} points={points} {...common} />;
        }

        return (
          <rect
            key={hold.id}
            x={hold.bbox.x}
            y={hold.bbox.y}
            width={hold.bbox.w}
            height={hold.bbox.h}
            {...common}
          />
        );
      })}
    </svg>
  );
}
