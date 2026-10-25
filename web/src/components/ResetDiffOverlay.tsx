import type { MouseEvent } from "react";
import type { ResetDiff } from "../lib/api/types";
import styles from "./ResetDiffOverlay.module.css";
import { resetHoldColors, type HoldColor } from "./resetHoldColors";

interface ResetDiffOverlayProps {
  diff: ResetDiff;
  aspectRatio: number;
  selected: { kind: HoldColor; id: string } | null;
  onSelect: (kind: HoldColor, holdId: string, oldHoldId?: string) => void;
}

type HoldShape = {
  id: string;
  bbox: { x: number; y: number; w: number; h: number };
  polygon: number[][] | null;
};

/** Diff marks share HoldOverlay's normalized image coordinates and letterboxed viewBox. */
export default function ResetDiffOverlay({ diff, aspectRatio, selected, onSelect }: ResetDiffOverlayProps) {
  const width = aspectRatio > 0 ? aspectRatio : 1;

  const renderHold = (hold: HoldShape, color: HoldColor, oldHoldId?: string) => {
    const colorStyle = resetHoldColors[color];
    const shapeProps = {
      fill: colorStyle.fill,
      stroke: selected?.kind === color && selected.id === hold.id ? "#fff" : colorStyle.stroke,
      strokeWidth: 2,
      ...(color === "removed" ? { strokeDasharray: "6 4" } : {}),
      vectorEffect: "non-scaling-stroke" as const,
      style: { cursor: "pointer" },
      onClick: (event: MouseEvent<SVGElement>) => {
        event.stopPropagation();
        onSelect(color, hold.id, oldHoldId);
      },
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
      {/* Removed holds go underneath so the new hold they overlap stays tappable. */}
      {diff.removed_holds.map((hold) =>
        renderHold({ ...hold, id: hold.old_hold_id }, "removed"),
      )}
      {diff.new_holds.map((hold) =>
        renderHold(
          hold,
          hold.matched_old_hold_id ? "kept" : "new",
          hold.matched_old_hold_id ?? undefined,
        ),
      )}
    </svg>
  );
}
