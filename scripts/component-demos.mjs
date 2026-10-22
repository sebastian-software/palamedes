import path from "node:path";
import { EXAMPLE_MATRIX, ROOT } from "./example-matrix.mjs";

export const COMPONENT_FRAMEWORKS = [
  { proof: "vue-vite", framework: "vue", basePort: 4090, rendering: "client" },
  { proof: "nuxt-ssr", framework: "nuxt", basePort: 4100, rendering: "ssr" },
  { proof: "svelte-vite", framework: "svelte", basePort: 4110, rendering: "client" },
  { proof: "sveltekit-ssr", framework: "sveltekit", basePort: 4120, rendering: "ssr" },
].map((family) => ({ ...family, cwd: path.join(ROOT, "proof", family.proof) }));

export const COMPONENT_DEMOS = COMPONENT_FRAMEWORKS.flatMap((family) =>
  ["cookie", "route", "subdomain", "tld"].map((strategy, index) => {
    const id = `${family.framework}-${strategy}`;
    const smokeChecks = [
      { locale: "en", title: "Book your seat at Frontend Stage 2026" },
      { locale: "de", title: "Sichere dir deinen Platz bei Frontend Stage 2026" },
      { locale: "fr", title: "Réservez votre place à Frontend Stage 2026" },
      { locale: "es", title: "Reserva tu plaza en Frontend Stage 2026" },
    ].map(({ locale, title }) => ({
      path: strategy === "route" ? `/${locale}` : "/",
      headers: {
        host:
          strategy === "tld"
            ? `${family.framework}.examples.palamedes-i18n.${locale === "en" ? "com" : locale}`
            : `${strategy === "subdomain" ? `${locale}.` : ""}${id}.examples.palamedes.dev`,
        "accept-language": strategy === "cookie" ? locale : "es",
      },
      ...(family.rendering === "ssr"
        ? { htmlLang: locale, substrings: [title, 'data-palamedes-time-zone="Europe/Berlin"'] }
        : { substrings: ["<html", 'type="module"', "/locale.js"] }),
    }));
    if (strategy === "route" && family.rendering === "ssr")
      smokeChecks.unshift({
        path: "/",
        headers: { host: `${id}.examples.palamedes.dev`, "accept-language": "de" },
        redirectTo: "/de",
        substrings: [],
      });
    return {
      ...family,
      id,
      strategy,
      port: family.basePort + index,
      build: ["build"],
      start:
        family.framework === "nuxt"
          ? ["exec", "node", ".output/server/index.mjs"]
          : family.framework === "sveltekit"
            ? ["exec", "node", "build/index.js"]
            : ["preview"],
      startEnv: { PALAMEDES_DEMO_STRATEGY: strategy },
      smokeChecks,
    };
  }),
);

export const CONTAINER_EXAMPLES = [...EXAMPLE_MATRIX, ...COMPONENT_DEMOS];
