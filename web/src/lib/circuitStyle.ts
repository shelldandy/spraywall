// Keep the color keys and emoji presets in sync with server/internal/route/circuits.go.
export const CIRCUIT_COLORS = {
  violet: "#6d28d9",
  orange: "#fb8c3c",
  green: "#047857",
  blue: "#2563eb",
  pink: "#db2777",
  teal: "#0891b2",
  amber: "#ca8a04",
  red: "#dc2626",
  slate: "#334155",
  ink: "#475569",
} as const;

export type CircuitColor = keyof typeof CIRCUIT_COLORS;

export const CIRCUIT_EMOJI = ["🔥", "💪", "🎯", "⭐", "🧗", "🪨", "🏆", "⚡", "🧠", "🦶", "🌀", "🐢"] as const;

export function randomCircuitStyle(): { color: CircuitColor; emoji: (typeof CIRCUIT_EMOJI)[number] } {
  const colors = Object.keys(CIRCUIT_COLORS) as CircuitColor[];
  return {
    color: colors[Math.floor(Math.random() * colors.length)],
    emoji: CIRCUIT_EMOJI[Math.floor(Math.random() * CIRCUIT_EMOJI.length)],
  };
}

export function circuitColor(key: string): string {
  return CIRCUIT_COLORS[key as CircuitColor] ?? CIRCUIT_COLORS.violet;
}
