import type { MouseEvent } from "react";
import type { ResetDiff } from "../lib/api/types";
import styles from "./ResetDiffOverlay.module.css";

interface ResetDiffOverlayProps {
  diff: ResetDiff;
  aspectRatio: number;
  selectedOldHoldId: string | null;
  onRemovedSelect: (oldHoldId: string) => void;
  onNewSelect: (newHoldId: string) => void;
  onChanged: (oldHoldId: string) => void;
}

type HoldShape = {
  id: string;
  bbox: { x: number; y: number; w: number; h: number };
  polygon: number[][] | null;
};

type HoldColor = "kept" | "new" | "removed";

const colors: Record<HoldColor, { fill: string; stroke: string }> = {
  kept: { fill: "rgba(0, 200, 83, 0.3)", stroke: "#00c853" },
  new: { fill: "rgba(0, 176, 255, 0.3)", stroke: "#00b0ff" },
  removed: { fill: "rgba(255, 23, 68, 0.3)", stroke: "#ff1744" },
};

/** Diff marks share HoldOverlay's normalized image coordinates and letterboxed viewBox. */
export default function ResetDiffOverlay({
  diff,
  aspectRatio,
  selectedOldHoldId,
  onRemovedSelect,
  onNewSelect,
  onChanged,
}: ResetDiffOverlayProps) {
  const width = aspectRatio > 0 ? aspectRatio : 1;

  const renderHold = (
    hold: HoldShape,
    color: HoldColor,
    onClick: (event: MouseEvent<SVGElement>) => void,
    selected = false,
  ) => {
    const colorStyle = colors[color];
    const shapeProps = {
      fill: colorStyle.fill,
      stroke: selected ? "#fff" : colorStyle.stroke,
      strokeWidth: 2,
      ...(color === "removed" ? { strokeDasharray: "6 4" } : {}),
      vectorEffect: "non-scaling-stroke" as const,
      style: { cursor: "pointer" },
      onClick,
    };

    if (hold.polygon?.length) {
      const points = hold.polygon.map(([x, y]) => `${x * width},${y}`).join(" ");
      return <polygon key={`${color}-${hold.id}`} points={points} {...shapeProps} />;
    }

    return (
      <rect
        key={`${color}-${hold.id}`}
        x={hold.bbox.x * width}
        y={hold.bbox.y}
        width={hold.bbox.w * width}
        height={hold.bbox.h}
        {...shapeProps}
      />
    );
  };

  return (
    <svg viewBox={`0 0 ${width} 1`} preserveAspectRatio="xMidYMid meet" className={styles.overlay}>
      {diff.new_holds.map((hold) =>
        renderHold(
          hold,
          hold.matched_old_hold_id ? "kept" : "new",
          (event) => {
            event.stopPropagation();
            if (selectedOldHoldId) {
              onNewSelect(hold.id);
            } else if (hold.matched_old_hold_id) {
              onChanged(hold.matched_old_hold_id);
            }
          },
        ),
      )}
      {diff.removed_holds.map((hold) =>
        renderHold(
          { ...hold, id: hold.old_hold_id },
          "removed",
          (event) => {
            event.stopPropagation();
            onRemovedSelect(hold.old_hold_id);
          },
          selectedOldHoldId === hold.old_hold_id,
        ),
      )}
    </svg>
  );
}
