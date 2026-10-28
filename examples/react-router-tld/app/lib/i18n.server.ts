import { createReactRouterI18n } from "@palamedes/react-router";
import { resolveLocaleFromRequest } from "./i18n";

export const i18n = createReactRouterI18n({
  resolveLocale: resolveLocaleFromRequest,
  i18nOptions: { timeZone: "Europe/Berlin" },
});
