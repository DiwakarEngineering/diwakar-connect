import type { Enums } from "./lib/database.types";

/** The website's design tokens (tailwind.config.ts): Diwakar orange, navy ink, warm canvas. */
export const colors = {
  brand50: "#FFF5ED",
  brand100: "#FFE7D5",
  brand200: "#FFCAA6",
  brand300: "#FCA66E",
  brand400: "#F7873F",
  brand500: "#F06A1A",
  /** Minimum orange for white text (4.6:1). */
  brand600: "#C84C0A",
  brand700: "#A33D08",
  brand800: "#7F300A",
  ink950: "#0E1422",
  ink900: "#151C2C",
  ink800: "#1F2839",
  ink700: "#2F394B",
  ink600: "#4A5466",
  ink500: "#5E6778",
  ink400: "#8A919E",
  ink300: "#B8BDC6",
  ink200: "#DDE0E5",
  ink100: "#EEF0F3",
  canvas: "#FBF9F6",
  line: "#ECE7E0",
  white: "#FFFFFF",
  success600: "#15803D",
  success50: "#ECFBF1",
  warning600: "#B45309",
  danger600: "#C42B2B",
  danger700: "#9F1F1F",
  danger50: "#FEF1F1",
  /** Meeting screen. */
  charcoal: "#1C1F26",
  charcoal2: "#262A33",
};

export const AVAILABILITY: Record<Enums<"availability">, { label: string; color: string }> = {
  available: { label: "Available", color: colors.success600 },
  busy: { label: "Busy", color: colors.danger600 },
  do_not_disturb: { label: "Do not disturb", color: colors.danger700 },
  away: { label: "Away", color: colors.warning600 },
  offline: { label: "Appear offline", color: colors.ink300 },
};

const PALETTE: [string, string][] = [
  [colors.brand100, colors.brand800],
  ["#E7EEFF", "#2B4C9B"],
  ["#E6F6EE", "#1E6B47"],
  ["#F3E8FF", "#6B3FA0"],
  ["#FFF1D6", "#8A5A00"],
  ["#E3F4F7", "#1F6474"],
];

/** Same initials colours as the website, so people look the same everywhere. */
export function paletteFor(seed: string): [string, string] {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  return PALETTE[Math.abs(hash) % PALETTE.length]!;
}
