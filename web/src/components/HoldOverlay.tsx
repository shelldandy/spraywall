import { useId, type MouseEvent, type SVGProps } from "react";
import type { Hold, HoldRoles } from "../lib/api/types";

type HoldRole = "normal" | "start" | "hand" | "finish" | "foot";

interface HoldOverlayProps {
  holds: Hold[];
  selectedIds: Set<string>;
  disabledIds?: ReadonlySet<string>;
  onToggle: (holdId: string) => void;
  mode?: "select" | "view" | "edit";
  holdRoles?: HoldRoles | null;
  editHoldMode?: "delete" | "add";
  holdToDelete?: string | null;
  selectedRoleById?: ReadonlyMap<string, HoldRole>;
  coordinateAspectRatio?: number;
  preserveAspectRatio?: "none" | "xMidYMid meet";
  /** Called with coordinates normalised to 0..1 when the image (not a hold) is clicked in add mode. */
  onBackgroundPress?: (normalizedX: number, normalizedY: number) => void;
  /** Small thumbnail rendering: thinner outlines and a tighter glow. */
  compact?: boolean;
}

/** Outline colour per role. Shared by every mode so the editor and route views match. */
const ROLE_STROKES: Record<HoldRole, string> = {
  start: "#00FF20",
  hand: "#00FFFF",
  finish: "#FF00E6",
  foot: "#FFA500",
  normal: "#00FFFF",
};

interface GlowLayer {
  width: number;
  opacity: number;
}

/**
 * Builds the glow as a stack of progressively wider, faint strokes rather than an SVG blur filter:
 * iOS Safari does not render the blur in this overlay, while plain strokes and masks work everywhere.
 *
 * Each stroke is centred on the hold edge and masked to the outside, so a stroke of width 2d reaches
 * d px outwards. Layer opacities are solved from the outermost layer inwards so the composited glow
 * follows `peak * exp(-d² / 2σ²)` at each step, giving a soft falloff with no solid band at the edge.
 */
function buildGlowLayers(peak: number, sigma: number, step: number, reach: number): GlowLayer[] {
  const alphaAt = (d: number) => peak * Math.exp(-(d * d) / (2 * sigma * sigma));
  const layers: GlowLayer[] = [];
  let outerAlpha = 0;
  for (let d = reach; d >= step - 1e-9; d -= step) {
    const alpha = alphaAt(d);
    layers.push({ width: 2 * d, opacity: 1 - (1 - alpha) / (1 - outerAlpha) });
    outerAlpha = alpha;
  }
  return layers;
}

/** Selected-hold outline sizing, in screen px. */
const SELECTED_STYLE = {
  regular: { outline: 2, glow: buildGlowLayers(0.8, 3.2, 1, 10) },
  compact: { outline: 1.25, glow: buildGlowLayers(0.7, 1.2, 0.5, 3) },
};

function getSelectedStroke(holdId: string, holdRoles?: HoldRoles | null, selectedRole?: HoldRole) {
  if (selectedRole) return ROLE_STROKES[selectedRole];
  if (holdRoles?.start?.includes(holdId)) return ROLE_STROKES.start;
  if (holdRoles?.finish?.includes(holdId)) return ROLE_STROKES.finish;
  if (holdRoles?.foot?.includes(holdId)) return ROLE_STROKES.foot;
  return ROLE_STROKES.normal;
}

function getUnselectedColors(holdId: string, mode: "select" | "view" | "edit", holdToDelete?: string | null) {
  if (holdToDelete === holdId) return { fill: "rgba(255, 0, 0, 0.5)", stroke: "#FF0000" };
  // Selecting holds for a climb: unselected holds are invisible but still tappable ("transparent" is painted).
  if (mode === "select") return { fill: "transparent", stroke: "none" };
  return mode === "view"
    ? { fill: "rgba(255, 255, 255, 0.15)", stroke: "rgba(255, 255, 255, 0.2)" }
    : { fill: "rgba(255, 255, 255, 0.25)", stroke: "#FFFFFF" };
}

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
 *
 * Selected holds are drawn the same way in every mode: a crisp role-coloured outline with a soft
 * glow that only spreads outwards, leaving the inside clear so the real hold colour stays visible.
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
  compact = false,
}: HoldOverlayProps) {
  const idBase = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const maskId = `hold-outside-mask-${idBase}`;
  const aspectRatio = coordinateAspectRatio && coordinateAspectRatio > 0 ? coordinateAspectRatio : null;
  const xScale = aspectRatio ?? 1;
  const viewBox = aspectRatio ? `0 0 ${aspectRatio} 1` : "0 0 1 1";
  const sizes = compact ? SELECTED_STYLE.compact : SELECTED_STYLE.regular;

  const isSpotlit = (holdId: string) => selectedIds.has(holdId) && holdToDelete !== holdId;
  const spotlitHolds = holds
    .filter((hold) => isSpotlit(hold.id))
    .map((hold) => ({
      hold,
      shape: getHoldShape(hold, xScale),
      stroke: getSelectedStroke(hold.id, holdRoles, selectedRoleById?.get(hold.id)),
    }));

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
      <defs>
        {/* White = outside the selected holds. Keeps the dimming and the glow off the holds themselves. */}
        <mask id={maskId} maskUnits="userSpaceOnUse" x={0} y={0} width={xScale} height={1}>
          <rect x={0} y={0} width={xScale} height={1} fill="white" />
          {spotlitHolds.map(({ hold, shape }) => renderHoldShape(shape, { fill: "black" }, hold.id))}
        </mask>
      </defs>
      {/* Dim the wall outside the selected holds so they pop (not while editing the hold layout). */}
      {mode !== "edit" && (
        <rect
          x={0}
          y={0}
          width={xScale}
          height={1}
          fill="rgba(0, 0, 0, 0.5)"
          mask={`url(#${maskId})`}
          style={{ pointerEvents: "none" }}
        />
      )}
      {spotlitHolds.length > 0 && (
        <g mask={`url(#${maskId})`} style={{ pointerEvents: "none" }}>
          {spotlitHolds.flatMap(({ hold, shape, stroke }) =>
            sizes.glow.map(({ width, opacity }) =>
              renderHoldShape(
                shape,
                {
                  fill: "none",
                  stroke,
                  strokeOpacity: opacity,
                  strokeWidth: width,
                  strokeLinejoin: "round",
                  vectorEffect: "non-scaling-stroke",
                },
                `${hold.id}-glow-${width}`,
              ),
            ),
          )}
        </g>
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
        const shape = getHoldShape(hold, xScale);
        const spotlit = isSpotlit(hold.id);
        const isDisabled = !selectedIds.has(hold.id) && (disabledIds?.has(hold.id) ?? false);
        const interactive = mode !== "view";
        const handleClick = (e: MouseEvent) => {
          e.stopPropagation();
          if (!isDisabled) onToggle(hold.id);
        };

        if (spotlit) {
          return renderHoldShape(
            shape,
            {
              fill: "none",
              stroke: getSelectedStroke(hold.id, holdRoles, selectedRoleById?.get(hold.id)),
              strokeWidth: sizes.outline,
              vectorEffect: "non-scaling-stroke",
              // "visible" keeps the clear inside tappable so holds can still be deselected.
              style: interactive ? { cursor: "pointer", pointerEvents: "visible" } : { pointerEvents: "none" },
              onClick: interactive ? handleClick : undefined,
            },
            hold.id,
          );
        }

        const colors = getUnselectedColors(hold.id, mode, holdToDelete);
        return renderHoldShape(
          shape,
          {
            fill: colors.fill,
            stroke: colors.stroke,
            strokeWidth: compact ? 1 : 2,
            vectorEffect: "non-scaling-stroke",
            "aria-disabled": isDisabled || undefined,
            style: { cursor: isDisabled ? "default" : "pointer", opacity: isDisabled ? 0.25 : undefined },
            onClick: handleClick,
          },
          hold.id,
        );
      })}
    </svg>
  );
}
