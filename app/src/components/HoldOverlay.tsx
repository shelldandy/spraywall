import React from "react";
import { Platform } from "react-native";
import Svg, { Rect } from "react-native-svg";
import type { Hold } from "../lib/api/types";

interface HoldOverlayProps {
  holds: Hold[];
  selectedIds: Set<string>;
  onToggle: (holdId: string) => void;
  imageWidth: number;
  imageHeight: number;
}

export default function HoldOverlay({
  holds,
  selectedIds,
  onToggle,
  imageWidth,
  imageHeight,
}: HoldOverlayProps) {
  return (
    <Svg
      width={imageWidth}
      height={imageHeight}
      style={{ position: "absolute", top: 0, left: 0 }}
    >
      {holds.map((hold) => {
        const isSelected = selectedIds.has(hold.id);
        const x = hold.bbox.x * imageWidth;
        const y = hold.bbox.y * imageHeight;
        const w = hold.bbox.w * imageWidth;
        const h = hold.bbox.h * imageHeight;

        const pressHandler = () => onToggle(hold.id);

        return (
          <Rect
            key={hold.id}
            x={x}
            y={y}
            width={w}
            height={h}
            fill={isSelected ? "rgba(0, 255, 255, 0.35)" : "rgba(255, 255, 255, 0.25)"}
            stroke={isSelected ? "#00FFFF" : "#FFFFFF"}
            strokeWidth={2}
            {...(Platform.OS === "web"
              ? { onClick: pressHandler }
              : { onPress: pressHandler })}
          />
        );
      })}
    </Svg>
  );
}
