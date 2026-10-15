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
  selectedRoleById?: ReadonlyMap<string, "normal" | "start" | "hand" | "finish" | "foot">;
  coordinateAspectRatio?: number;
  preserveAspectRatio?: "none" | "xMidYMid meet";
  /** Called with coordinates normalised to 0..1 when the image (not a hold) is clicked in add mode. */
  onBackgroundPress?: (normalizedX: number, normalizedY: number) => void;
}

function getHoldColor(
  holdId: string,
  isSelected: boolean,
  holdRoles?: HoldRoles | null,
  mode?: "select" | "view" | "edit",
  holdToDelete?: string | null,
  selectedRole?: "normal" | "start" | "hand" | "finish" | "foot",
) {
  if (holdToDelete === holdId)
    return { fill: "rgba(255, 0, 0, 0.5)", stroke: "#FF0000" };

  if (!isSelected)
    return mode === "view"
      ? { fill: "rgba(255, 255, 255, 0.15)", stroke: "rgba(255, 255, 255, 0.2)" }
      : { fill: "rgba(255, 255, 255, 0.25)", stroke: "#FFFFFF" };

  const roleColors = {
    start: { fill: "rgba(0, 255, 0, 0.45)", stroke: "#00FF20" },
    hand: { fill: "rgba(0, 255, 255, 0.4)", stroke: "#00FFFF" },
    finish: { fill: "rgba(255, 0, 230, 0.45)", stroke: "#FF00E6" },
    foot: { fill: "rgba(255, 165, 0, 0.45)", stroke: "#FFA500" },
    normal: { fill: "rgba(0, 255, 255, 0.35)", stroke: "#00FFFF" },
  };
  if (selectedRole) return roleColors[selectedRole];

  if (holdRoles) {
    if (holdRoles.start.includes(holdId))
      return { fill: "rgba(0, 200, 0, 0.4)", stroke: "#00CC00" };
    if (holdRoles.finish.includes(holdId))
      return { fill: "rgba(255, 50, 50, 0.4)", stroke: "#FF3333" };
    if (holdRoles.foot?.includes(holdId)) return roleColors.foot;
  }

  return { fill: "rgba(0, 255, 255, 0.35)", stroke: "#00FFFF" };
}

/**
 * SVG layer drawn over a wall image. Hold coordinates are normalised (0..1); when the
 * source aspect ratio is provided, the viewBox preserves the image's letterboxed bounds.
 */
export default function HoldOverlay({
  holds,
  selectedIds,
  onToggle,
  mode = "select",
  holdRoles,
  editHoldMode,
  holdToDelete,
  selectedRoleById,
  coordinateAspectRatio,
  preserveAspectRatio = "none",
  onBackgroundPress,
}: HoldOverlayProps) {
  const aspectRatio = coordinateAspectRatio && coordinateAspectRatio > 0 ? coordinateAspectRatio : null;
  const viewBox = aspectRatio ? `0 0 ${aspectRatio} 1` : "0 0 1 1";

  const handleBackgroundClick = (evt: MouseEvent<SVGRectElement>) => {
    // The rect's client rect includes any zoom transform, so this stays correct when zoomed.
    const bounds = evt.currentTarget.getBoundingClientRect();
    const normX = (evt.clientX - bounds.left) / bounds.width;
    const normY = (evt.clientY - bounds.top) / bounds.height;
    onBackgroundPress?.(normX, normY);
  };

  return (
    <svg
      viewBox={viewBox}
      preserveAspectRatio={aspectRatio ? "xMidYMid meet" : preserveAspectRatio}
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
    >
      {mode === "view" && (
        <rect x={0} y={0} width={aspectRatio ?? 1} height={1} fill="rgba(0, 0, 0, 0.5)" />
      )}
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
        const colors = getHoldColor(
          hold.id,
          isSelected,
          holdRoles,
          mode,
          holdToDelete,
          selectedRoleById?.get(hold.id),
        );
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
          const points = hold.polygon
            .map(([px, py]) => `${px * (aspectRatio ?? 1)},${py}`)
            .join(" ");
          return <polygon key={hold.id} points={points} {...common} />;
        }

        return (
          <rect
            key={hold.id}
            x={hold.bbox.x * (aspectRatio ?? 1)}
            y={hold.bbox.y}
            width={hold.bbox.w * (aspectRatio ?? 1)}
            height={hold.bbox.h}
            {...common}
          />
        );
      })}
    </svg>
  );
}
