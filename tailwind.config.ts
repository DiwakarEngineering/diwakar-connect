import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Diwakar orange. 600 is the minimum for white text (4.6:1).
        brand: {
          50: "#FFF5ED",
          100: "#FFE7D5",
          200: "#FFCAA6",
          300: "#FCA66E",
          400: "#F7873F",
          500: "#F06A1A",
          600: "#C84C0A",
          700: "#A33D08",
          800: "#7F300A",
          900: "#5F250B",
        },
        ink: {
          950: "#0E1422",
          900: "#151C2C",
          800: "#1F2839",
          700: "#2F394B",
          600: "#4A5466",
          500: "#5E6778",
          400: "#8A919E",
          300: "#B8BDC6",
          200: "#DDE0E5",
          100: "#EEF0F3",
        },
        canvas: "#FBF9F6",
        line: "#ECE7E0",
        success: { 50: "#ECFBF1", 600: "#15803D", 700: "#166534" },
        warning: { 50: "#FFF8E6", 600: "#B45309", 700: "#92400E" },
        danger: { 50: "#FEF1F1", 600: "#C42B2B", 700: "#9F1F1F" },
      },
      fontFamily: {
        sans: ["var(--font-inter)", "ui-sans-serif", "system-ui", "Segoe UI", "Roboto", "sans-serif"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(21, 28, 44, 0.04), 0 1px 3px rgba(21, 28, 44, 0.06)",
        pop: "0 8px 24px rgba(21, 28, 44, 0.12), 0 2px 6px rgba(21, 28, 44, 0.08)",
      },
      keyframes: {
        "fade-in": { from: { opacity: "0" }, to: { opacity: "1" } },
        "slide-up": { from: { opacity: "0", transform: "translateY(6px)" }, to: { opacity: "1", transform: "none" } },
      },
      animation: {
        "fade-in": "fade-in 120ms ease-out",
        "slide-up": "slide-up 160ms ease-out",
      },
    },
  },
  plugins: [],
};

export default config;
