import { createReactRouterI18n } from "@palamedes/react-router";
import { resolveLocaleFromRequest } from "./i18n";

export const i18n = createReactRouterI18n({
  resolveLocale: (request) => resolveLocaleFromRequest(request).locale,
  i18nOptions: { timeZone: "Europe/Berlin" },
  failureMessage: "The page catalog could not be loaded.",
});
