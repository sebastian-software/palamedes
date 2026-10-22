import { defineNuxtPlugin, tryUseNuxtApp, useState as nuxtState } from "#app";
import { useHead } from "#imports";
import { getQuery } from "h3";
import { createServerI18nScope } from "@palamedes/runtime/server";
import { createBundledServerI18n } from "@palamedes/runtime/server/bundled";
import { resolveLocale, timeZone } from "#shared/locale";

const scope = createServerI18nScope({
  requestKeyProvider: {
    id: Symbol.for("palamedes.nuxt.request"),
    get: () => tryUseNuxtApp()?.ssrContext?.event,
  },
});

export default defineNuxtPlugin({
  name: "palamedes",
  async setup(app) {
    const event = app.ssrContext!.event;
    const locale = resolveLocale(getQuery(event).locale);
    const i18n = await createBundledServerI18n({ locale, timeZone });
    app.runWithContext(() => {
      scope.activate(i18n);
      nuxtState("palamedes.locale", () => locale);
      useHead({ htmlAttrs: { lang: locale, "data-palamedes-time-zone": timeZone } });
    });
    event.context.palamedesLocale = locale;
  },
});
