import type { SnapCnTheme } from "@/lib/snap-cn-ui";

import { C, FONT } from "./brand";

/*
 * The site palette as a snapcn theme: one provider re-skins every vendored
 * component. Zero radius and the brand faces, per ADR-011.
 */
export const palamedesTheme: Partial<SnapCnTheme> = {
  background: C.paper,
  foreground: C.ink,
  card: C.paper,
  cardForeground: C.ink,
  popover: C.paper,
  popoverForeground: C.ink,
  primary: C.bronze,
  primaryForeground: C.paper,
  secondary: C.mist,
  secondaryForeground: C.ink,
  muted: C.mist,
  mutedForeground: C.slate,
  accent: C.bronze,
  accentForeground: C.paper,
  destructive: "#8f2d2d",
  destructiveForeground: C.paper,
  border: C.hair,
  input: C.hair,
  ring: C.bronze,
  radius: 0,
  fontFamily: FONT.sans,
};
