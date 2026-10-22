import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { createDemoLocalePolicy as policy } from "../packages/example-ui/src/demo-locale";

it("uses the cookie before quality-weighted browser preferences", () => {
  const url = new URL("https://vue-cookie.examples.palamedes.dev/?locale=fr");
  expect(policy(url, "locale=de", "es").locale).toBe("de");
  expect(policy(url, "locale=unknown", "fr;q=0,de-DE;q=0.8,es;q=0.3").locale).toBe("de");
});
it("keeps URL-selected locales authoritative and preserves page/query/hash on navigation", () => {
  const route = policy(
    new URL("https://nuxt-route.examples.palamedes.dev/de/insights?delay=2&locale=fr#details"),
    "locale=es",
    "fr",
  );
  expect(route.locale).toBe("de");
  expect(route.href("fr")).toBe(
    "https://nuxt-route.examples.palamedes.dev/fr/insights?delay=2#details",
  );
  expect(route.href("es", "/")).toBe(
    "https://nuxt-route.examples.palamedes.dev/es?delay=2#details",
  );
  expect(policy(new URL("https://nuxt-route.examples.palamedes.dev/"), "", "de").redirect).toBe(
    "https://nuxt-route.examples.palamedes.dev/de",
  );
  expect(
    policy(new URL("https://es.svelte-subdomain.examples.palamedes.dev/"), "locale=de", "fr")
      .locale,
  ).toBe("es");
  const tld = policy(new URL("https://sveltekit.examples.palamedes-i18n.fr/insights"));
  expect(tld.locale).toBe("fr");
  expect(tld.href("en")).toBe("https://sveltekit.examples.palamedes-i18n.com/insights");
});
it("retains query-selected locales for the standalone spike and serializes without closures", () => {
  expect(policy(new URL("http://localhost:4072/?locale=de")).locale).toBe("de");
  const bootstrapPolicy = runInNewContext(`(${policy.toString()})`, { URL });
  expect(bootstrapPolicy(new URL("https://svelte-route.examples.palamedes.dev/fr")).locale).toBe(
    "fr",
  );
  expect(() => policy(new URL("http://localhost"), "", "en", "invalid")).toThrow("Unknown demo");
});
