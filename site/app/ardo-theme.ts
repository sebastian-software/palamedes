import type { ArdoThemeProps } from "ardo/ui";

/** Keep the editorial palette on Ardo's public, typed theme contract. */
export const PALAMEDES_THEME = {
  tokens: {
    radius: {
      sm: "0px",
      base: "0px",
      lg: "0px",
      xl: "0px",
    },
    font: {
      family: "var(--font-sans)",
      familyHeading: "var(--font-sans)",
      mono: "var(--font-mono)",
      lineHeight: "1.65",
    },
  },
  light: {
    color: {
      brand: "#866026",
      brandDark: "#6f4f1e",
      brandSubtle: "#f4ecda",
      brandGradient: "var(--color-accent)",
      accent: "#866026",
      bg: "var(--color-paper)",
      bgSoft: "#f5f2e8",
      bgMute: "var(--color-track)",
      text: "var(--color-ink)",
      textLight: "#3f5471",
      textLighter: "#5d6c81",
      border: "var(--color-hair)",
      borderLight: "#e8e2d3",
      divider: "#e8e2d3",
      sidebarBg: "var(--color-paper)",
      // GitHub Light's syntax colors are measured against a white ground.
      codeBg: "#ffffff",
      codeBorder: "var(--color-hair)",
      codeShadow: "0 0 0 0 transparent",
      shadowSm: "0 0 0 0 transparent",
      shadowMd: "0 0 0 0 transparent",
      shadowLg: "0 0 0 0 transparent",
      brandInk: "var(--color-paper)",
      ring: "#866026",
      sidebarRailBg: "var(--color-paper)",
      headerBg: "var(--color-paper)",
      surfaceCard: "var(--color-paper)",
      surfaceInset: "#f5f2e8",
    },
  },
} satisfies ArdoThemeProps;
