import { useId, type MouseEvent, type SVGProps } from "react";
import type { Hold, HoldRoles } from "../lib/api/types";

interface HoldOverlayProps {
  holds: Hold[];
  selectedIds: Set<string>;
  disabledIds?: ReadonlySet<string>;
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
    if (holdRoles.start?.includes(holdId))
      return { fill: "rgba(0, 200, 0, 0.4)", stroke: "#00CC00" };
    if (holdRoles.finish?.includes(holdId))
      return { fill: "rgba(255, 50, 50, 0.4)", stroke: "#FF3333" };
    if (holdRoles.foot?.includes(holdId)) return roleColors.foot;
  }

  return { fill: "rgba(0, 255, 255, 0.35)", stroke: "#00FFFF" };
}

/** Blur radius for the view-mode glow, in normalised image units (1 = image height). */
const GLOW_BLUR = 0.005;

type HoldShape =
  | { kind: "polygon"; points: string }
  | { kind: "rect"; x: number; y: number; width: number; height: number };

function getHoldShape(hold: Hold, xScale: number): HoldShape {
  if (hold.polygon && hold.polygon.length > 0) {
    return {
      kind: "polygon",
      points: hold.polygon.map(([px, py]) => `${px * xScale},${py}`).join(" "),
    };
  }
  return {
    kind: "rect",
    x: hold.bbox.x * xScale,
    y: hold.bbox.y,
    width: hold.bbox.w * xScale,
    height: hold.bbox.h,
  };
}

function renderHoldShape(
  shape: HoldShape,
  props: SVGProps<SVGPolygonElement & SVGRectElement>,
  key?: string,
) {
  return shape.kind === "polygon" ? (
    <polygon key={key} points={shape.points} {...props} />
  ) : (
    <rect key={key} x={shape.x} y={shape.y} width={shape.width} height={shape.height} {...props} />
  );
}

/**
 * SVG layer drawn over a wall image. Hold coordinates are normalised (0..1); when the
 * source aspect ratio is provided, the viewBox preserves the image's letterboxed bounds.
 */
export default function HoldOverlay({
  holds,
  selectedIds,
  disabledIds,
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
  const idBase = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const maskId = `hold-dim-mask-${idBase}`;
  const glowId = `hold-glow-${idBase}`;
  const aspectRatio = coordinateAspectRatio && coordinateAspectRatio > 0 ? coordinateAspectRatio : null;
  const xScale = aspectRatio ?? 1;
  const viewBox = aspectRatio ? `0 0 ${aspectRatio} 1` : "0 0 1 1";
  const spotlitHolds =
    mode === "view"
      ? holds
          .filter((hold) => selectedIds.has(hold.id) && holdToDelete !== hold.id)
          .map((hold) => ({
            hold,
            shape: getHoldShape(hold, xScale),
            stroke: getHoldColor(hold.id, true, holdRoles, mode, holdToDelete, selectedRoleById?.get(hold.id)).stroke,
          }))
      : [];

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
        <>
          {/* One filter region covering the whole image, so the blur is never clipped per hold. */}
          <filter id={glowId} filterUnits="userSpaceOnUse" x={0} y={0} width={xScale} height={1}>
            <feGaussianBlur stdDeviation={GLOW_BLUR} />
          </filter>
          {/* White = outside the selected holds. Used to dim the wall and to keep the glow outside the holds. */}
          <mask id={maskId} maskUnits="userSpaceOnUse" x={0} y={0} width={xScale} height={1}>
            <rect x={0} y={0} width={xScale} height={1} fill="white" />
            {spotlitHolds.map(({ hold, shape }) => renderHoldShape(shape, { fill: "black" }, hold.id))}
          </mask>
          <rect x={0} y={0} width={xScale} height={1} fill="rgba(0, 0, 0, 0.5)" mask={`url(#${maskId})`} />
          <g mask={`url(#${maskId})`} style={{ pointerEvents: "none" }}>
            <g filter={`url(#${glowId})`}>
              {spotlitHolds.map(({ hold, shape, stroke }) =>
                renderHoldShape(
                  shape,
                  { fill: "none", stroke, strokeWidth: 8, vectorEffect: "non-scaling-stroke" },
                  hold.id,
                ),
              )}
            </g>
          </g>
        </>
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
        const isDisabled = !isSelected && (disabledIds?.has(hold.id) ?? false);
        const colors = getHoldColor(
          hold.id,
          isSelected,
          holdRoles,
          mode,
          holdToDelete,
          selectedRoleById?.get(hold.id),
        );
        const shape = getHoldShape(hold, xScale);

        // View mode: a crisp outline only (the outward glow is drawn above), so the real hold colour shows.
        if (mode === "view" && isSelected && holdToDelete !== hold.id) {
          return renderHoldShape(
            shape,
            { fill: "none", stroke: colors.stroke, strokeWidth: 2, vectorEffect: "non-scaling-stroke", style: { pointerEvents: "none" } },
            hold.id,
          );
        }

        const common = {
          fill: colors.fill,
          stroke: colors.stroke,
          strokeWidth: 2,
          vectorEffect: "non-scaling-stroke" as const,
          "aria-disabled": isDisabled || undefined,
          style: { cursor: isDisabled ? "default" : "pointer", opacity: isDisabled ? 0.25 : undefined },
          onClick: (e: MouseEvent) => {
            e.stopPropagation();
            if (!isDisabled) onToggle(hold.id);
          },
        };

        return renderHoldShape(shape, common, hold.id);
      })}
    </svg>
  );
}
