import React from "react";

import Svg, { Polygon, Rect } from "react-native-svg";
import type { Hold, HoldRoles } from "../lib/api/types";

interface HoldOverlayProps {
  holds: Hold[];
  selectedIds: Set<string>;
  onToggle: (holdId: string) => void;
  imageWidth: number;
  imageHeight: number;
  mode?: "select" | "view";
  holdRoles?: HoldRoles | null;
}

function getHoldColor(
  holdId: string,
  isSelected: boolean,
  holdRoles?: HoldRoles | null,
  mode?: "select" | "view",
) {
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

export default function HoldOverlay({
  holds,
  selectedIds,
  onToggle,
  imageWidth,
  imageHeight,
  mode = "select",
  holdRoles,
}: HoldOverlayProps) {
  const visibleHolds = holds;

  return (
    <Svg
      width={imageWidth}
      height={imageHeight}
      style={{ position: "absolute", top: 0, left: 0 }}
    >
      {mode === "view" && (
        <Rect
          x={0}
          y={0}
          width={imageWidth}
          height={imageHeight}
          fill="rgba(0, 0, 0, 0.5)"
        />
      )}
      {visibleHolds.map((hold) => {
        const isSelected = selectedIds.has(hold.id);
        const x = hold.bbox.x * imageWidth;
        const y = hold.bbox.y * imageHeight;
        const w = hold.bbox.w * imageWidth;
        const h = hold.bbox.h * imageHeight;
        const colors = getHoldColor(hold.id, isSelected, holdRoles, mode);

        const pressHandler = () => onToggle(hold.id);

        const interactionProps = { onPress: pressHandler };

        if (hold.polygon && hold.polygon.length > 0) {
          const points = hold.polygon
            .map(([px, py]) => `${px * imageWidth},${py * imageHeight}`)
            .join(" ");

          return (
            <Polygon
              key={hold.id}
              points={points}
              fill={colors.fill}
              stroke={colors.stroke}
              strokeWidth={2}
              {...interactionProps}
            />
          );
        }

        return (
          <Rect
            key={hold.id}
            x={x}
            y={y}
            width={w}
            height={h}
            fill={colors.fill}
            stroke={colors.stroke}
            strokeWidth={2}
            {...interactionProps}
          />
        );
      })}
    </Svg>
  );
}
