import type { ArdoThemeProps } from "ardo/ui";

/** One palette for the native Ardo shell and local product specimens. */
export const PALAMEDES_THEME = {
  color: "amber",
  accent: "amber",
  neutral: "blue",
  light: {
    color: {
      brand: "#866026",
      brandDark: "#6f4f1e",
      brandSubtle: "#f4ecda",
      brandInk: "#ffffff",
      accent: "#866026",
      ring: "#866026",
      bg: "#faf9f4",
      bgSoft: "#f3efe3",
      bgMute: "#e8edf2",
      text: "#0e2a4d",
      textLight: "#3f5471",
      // Also meets AA on the footer's brand-tinted parchment surface.
      textLighter: "#526176",
      border: "#ddd6c6",
      borderLight: "#e8e2d3",
      divider: "#ddd6c6",
      headerBg: "var(--ardo-color-bg)",
      sidebarBg: "var(--ardo-color-bg)",
      sidebarRailBg: "var(--ardo-color-bgSoft)",
    },
  },
} satisfies ArdoThemeProps;
