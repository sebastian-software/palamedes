import { createReactRouterI18n } from "@palamedes/react-router";
export const i18n = createReactRouterI18n({
  resolveLocale: (request) => (new URL(request.url).pathname.startsWith("/de") ? "de" : "en"),
  catalogDelivery: false,
});
