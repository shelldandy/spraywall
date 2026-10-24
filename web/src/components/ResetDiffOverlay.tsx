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

/** Diff marks share HoldOverlay's normalized image coordinates and letterboxed viewBox. */
export default function ResetDiffOverlay({ diff, aspectRatio, selectedOldHoldId, onRemovedSelect, onNewSelect, onChanged }: ResetDiffOverlayProps) {
  const width = aspectRatio > 0 ? aspectRatio : 1;
  const holdShape = (hold: { id: string; bbox: { x: number; y: number; w: number; h: number }; polygon: number[][] | null }, color: "kept" | "new" | "removed", click: (event: MouseEvent<SVGElement>) => void, selected = false) => {
    const colors = color === "kept" ? ["rgba(0,200,83,.3)", "#00c853"] : color === "new" ? ["rgba(0,176,255,.3)", "#00b0ff"] : ["rgba(255,23,68,.3)", "#ff1744"];
    const props = { fill: colors[0], stroke: selected ? "#fff" : colors[1], strokeWidth: 2, ...(color === "removed" ? { strokeDasharray: "6 4" } : {}), vectorEffect: "non-scaling-stroke" as const, style: { cursor: "pointer" }, onClick: click };
    if (hold.polygon?.length) return <polygon key={`${color}-${hold.id}`} points={hold.polygon.map(([x,y]) => `${x * width},${y}`).join(" ")} {...props}/>;
    return <rect key={`${color}-${hold.id}`} x={hold.bbox.x * width} y={hold.bbox.y} width={hold.bbox.w * width} height={hold.bbox.h} {...props}/>;
  };
  return <svg viewBox={`0 0 ${width} 1`} preserveAspectRatio="xMidYMid meet" className={styles.overlay}>
    {diff.new_holds.map(hold => holdShape(hold, hold.matched_old_hold_id ? "kept" : "new", event => { event.stopPropagation(); if (selectedOldHoldId) onNewSelect(hold.id); else if (hold.matched_old_hold_id) onChanged(hold.matched_old_hold_id); }))}
    {diff.removed_holds.map(hold => holdShape({ ...hold, id: hold.old_hold_id }, "removed", event => { event.stopPropagation(); onRemovedSelect(hold.old_hold_id); }, selectedOldHoldId === hold.old_hold_id))}
  </svg>;
}
