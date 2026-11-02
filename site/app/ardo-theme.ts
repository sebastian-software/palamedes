import type { ArdoThemeProps } from "ardo/ui";

/** Local brand choices; Ardo derives accessible surfaces, text, and borders. */
export const PALAMEDES_THEME = {
  color: "amber",
  accent: "amber",
  neutral: "blue",
  // GitHub Light comments need the highlighter’s white reference background.
  light: { color: { codeBg: "#ffffff" } },
} satisfies ArdoThemeProps;
