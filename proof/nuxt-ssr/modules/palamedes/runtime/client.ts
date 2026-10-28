import { defineNuxtPlugin, useState as nuxtState } from "#app";
import { createI18n } from "@palamedes/core";
import { initializeClientI18n } from "@palamedes/runtime/internal";

export default defineNuxtPlugin({
  name: "palamedes",
  setup() {
    const locale = nuxtState<string>("palamedes.locale").value;
    if (document.documentElement.lang !== locale) {
      throw new Error("Nuxt hydration locale does not match the document catalog.");
    }
    initializeClientI18n(locale, () =>
      createI18n({ locale, timeZone: document.documentElement.dataset.palamedesTimeZone }),
    );
  },
});
