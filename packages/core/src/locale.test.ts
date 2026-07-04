import { describe, expect, it } from "vitest"
import { buildLocaleSwitchItems, defineLocaleControls } from "./locale"

const controls = defineLocaleControls({
  locales: ["en", "de", "es"] as const,
  defaultLocale: "en",
})

const hosted = defineLocaleControls({
  locales: ["en", "de", "es"] as const,
  defaultLocale: "en",
  hosts: {
    locales: {
      de: "de.lvh.me:4100",
      en: "en.lvh.me:4100",
      es: "es.lvh.me:4100",
    },
  },
})

const subdomained = defineLocaleControls({
  locales: ["en", "de", "es"] as const,
  defaultLocale: "en",
  hosts: { mode: "subdomain" },
})

const tlded = defineLocaleControls({
  locales: ["en", "de", "es", "fr"] as const,
  defaultLocale: "en",
  hosts: { mode: "tld", tld: { at: "de" }, defaultTld: "com" },
})

describe("locale controls", () => {
  it("resolves cookie locale before accept-language", () => {
    expect(
      controls.resolve({
        strategy: "cookie",
        acceptLanguageHeader: "de",
        cookieHeader: "locale=es",
      })
    ).toStrictEqual({ locale: "es", source: "cookie" })
  })

  it("resolves the route locale before accept-language", () => {
    expect(controls.resolve({ strategy: "route", routeLocale: "de" })).toStrictEqual({
      locale: "de",
      source: "route",
    })
    expect(
      controls.resolve({ strategy: "route", routeLocale: "xx", acceptLanguageHeader: "de" })
    ).toStrictEqual({ locale: "de", source: "accept-language" })
  })

  it("prefers supported accept-language entries", () => {
    expect(controls.preferredLocale("fr-CA, de;q=0.9, en;q=0.8")).toBe("de")
    expect(controls.preferredLocale("it, fr")).toBe("en")
  })

  it("derives stable locale labels from Intl.DisplayNames", () => {
    expect(controls.labels).toStrictEqual({ en: "English", de: "Deutsch", es: "español" })
    expect(controls.label("es")).toBe("español")
  })

  it("honours label overrides", () => {
    const custom = defineLocaleControls({
      locales: ["en", "de"] as const,
      defaultLocale: "en",
      labels: { de: "Deutsch (DE)" },
    })
    expect(custom.label("de")).toBe("Deutsch (DE)")
  })

  it("reads and serializes the deliberate-choice cookie", () => {
    expect(controls.readChoice("foo=bar; locale-choice=de")).toBe("de")
    expect(controls.readChoice("locale-choice=xx")).toBeNull()
    expect(controls.serializeChoice("de")).toContain("locale-choice=de")
  })

  it("supports custom cookie names", () => {
    const custom = defineLocaleControls({
      locales: ["en", "de"] as const,
      defaultLocale: "en",
      cookies: { choice: "lang-pick" },
    })
    expect(custom.readChoice("lang-pick=de")).toBe("de")
    expect(custom.serializeChoice("de")).toContain("lang-pick=de")
  })

  it("extracts and replaces locale path segments", () => {
    expect(controls.extractLocaleFromPath("/de/products")).toBe("de")
    expect(controls.replaceLocaleInPath("/de/products", "es")).toBe("/es/products")
    expect(controls.replaceLocaleInPath("/", "de")).toBe("/de")
  })

  it("builds canonical urls across hosts", () => {
    expect(
      hosted.canonicalUrl({
        locale: "es",
        pathname: "/de/docs",
        requestHost: "de.lvh.me:4100",
        search: "?probe=1",
      })
    ).toBe("http://es.lvh.me:4100/es/docs?probe=1")
  })

  it("suggests on accept-language and host mismatch", () => {
    expect(
      controls.suggest({ acceptLanguageHeader: "de", currentLocale: "en", pathname: "/en" })
        ?.recommendedLocale
    ).toBe("de")

    expect(
      hosted.suggest({ currentLocale: "en", pathname: "/en", requestHost: "de.lvh.me:4100" })
        ?.reason
    ).toBe("host")
  })

  it("silences the suggestion after a deliberate choice", () => {
    // choice=en overrides the German browser preference
    expect(
      controls.suggest({
        acceptLanguageHeader: "de",
        cookieHeader: "locale-choice=en",
        currentLocale: "en",
        pathname: "/en",
      })
    ).toBeNull()
  })

  it("builds headless switch items", () => {
    const items = controls.switchItems({ currentLocale: "de" })
    expect(items.map((item) => item.locale)).toStrictEqual(["en", "de", "es"])
    expect(items.find((item) => item.locale === "de")?.active).toBe(true)
    expect(items.find((item) => item.locale === "en")?.testId).toBe("locale-switch-en")
  })

  it("exposes buildLocaleSwitchItems standalone", () => {
    const items = buildLocaleSwitchItems({ currentLocale: "en", locales: ["en", "de"] as const })
    expect(items).toHaveLength(2)
    expect(items[0]?.active).toBe(true)
  })
})

describe("subdomain strategy", () => {
  it("resolves the locale authoritatively from the leftmost host label", () => {
    expect(
      subdomained.resolve({ strategy: "subdomain", requestHost: "de.example.com" })
    ).toStrictEqual({ locale: "de", source: "subdomain" })
  })

  it("strips the port and lowercases the label before matching", () => {
    expect(
      subdomained.resolve({ strategy: "subdomain", requestHost: "DE.lvh.me:4012" })
    ).toStrictEqual({ locale: "de", source: "subdomain" })
  })

  it("beats accept-language: the host wins over the browser preference", () => {
    expect(
      subdomained.resolve({
        strategy: "subdomain",
        requestHost: "es.nextjs-subdomain.examples.palamedes.dev",
        acceptLanguageHeader: "de",
      })
    ).toStrictEqual({ locale: "es", source: "subdomain" })
  })

  it("falls back to accept-language for an unknown leftmost label", () => {
    expect(
      subdomained.resolve({
        strategy: "subdomain",
        requestHost: "www.example.com",
        acceptLanguageHeader: "de",
      })
    ).toStrictEqual({ locale: "de", source: "accept-language" })
  })

  it("treats a language-shaped but unsupported label as unknown", () => {
    // "fr" looks like a locale but is not in the supported set.
    expect(
      subdomained.resolve({
        strategy: "subdomain",
        requestHost: "fr.example.com",
        acceptLanguageHeader: "de",
      })
    ).toStrictEqual({ locale: "de", source: "accept-language" })
  })

  it("falls back to the default locale when no host is given", () => {
    expect(subdomained.resolve({ strategy: "subdomain" })).toStrictEqual({
      locale: "en",
      source: "default",
    })
  })

  it("builds switch urls by swapping the leftmost label and keeping the path", () => {
    expect(
      subdomained.canonicalUrl({
        locale: "en",
        pathname: "/checkout",
        requestHost: "de.nextjs-subdomain.examples.palamedes.dev",
        search: "?seat=1",
      })
    ).toBe("http://en.nextjs-subdomain.examples.palamedes.dev/checkout?seat=1")
  })

  it("preserves the request port in switch urls", () => {
    expect(
      subdomained.canonicalUrl({
        locale: "es",
        pathname: "/",
        requestHost: "de.lvh.me:4012",
      })
    ).toBe("http://es.lvh.me:4012/")
  })

  it("prepends the locale label when the host has none yet", () => {
    expect(
      subdomained.canonicalUrl({
        locale: "de",
        pathname: "/",
        requestHost: "nextjs-subdomain.examples.palamedes.dev",
      })
    ).toBe("http://de.nextjs-subdomain.examples.palamedes.dev/")
  })

  it("returns a bare path when no request host is available", () => {
    expect(
      subdomained.canonicalUrl({ locale: "de", pathname: "/checkout", search: "?seat=1" })
    ).toBe("/checkout?seat=1")
  })

  it("raises no host banner when the host matches the rendered locale", () => {
    // Accept-Language also matches, so the only banner that could fire is the
    // host one — and it must stay silent because the host encodes the locale.
    expect(
      subdomained.suggest({
        acceptLanguageHeader: "de",
        currentLocale: "de",
        pathname: "/",
        requestHost: "de.lvh.me:4012",
      })
    ).toBeNull()
  })

  it("still surfaces an accept-language mismatch under the subdomain strategy", () => {
    const suggestion = subdomained.suggest({
      acceptLanguageHeader: "es",
      currentLocale: "de",
      pathname: "/",
      requestHost: "de.lvh.me:4012",
    })
    expect(suggestion?.reason).toBe("accept-language")
    expect(suggestion?.recommendedLocale).toBe("es")
    expect(suggestion?.recommendedUrl).toBe("http://es.lvh.me:4012/")
  })
})

describe("tld strategy", () => {
  it("resolves the locale authoritatively when the tld label is a supported locale", () => {
    expect(
      tlded.resolve({ strategy: "tld", requestHost: "nextjs.palamedes-i18n.de" })
    ).toStrictEqual({ locale: "de", source: "tld" })
  })

  it("resolves the newly added fourth locale from its tld", () => {
    expect(
      tlded.resolve({ strategy: "tld", requestHost: "nextjs.palamedes-i18n.fr" })
    ).toStrictEqual({ locale: "fr", source: "tld" })
  })

  it("strips the port and lowercases the tld before matching", () => {
    expect(tlded.resolve({ strategy: "tld", requestHost: "palamedes-i18n.DE:4013" })).toStrictEqual(
      { locale: "de", source: "tld" }
    )
  })

  it("resolves an explicit tld override whose label is not a locale code", () => {
    // `.at` is Austria, not a language code, but is mapped to German.
    expect(tlded.resolve({ strategy: "tld", requestHost: "shop.palamedes-i18n.at" })).toStrictEqual(
      { locale: "de", source: "tld" }
    )
  })

  it("beats accept-language: the tld wins over the browser preference", () => {
    expect(
      tlded.resolve({
        strategy: "tld",
        requestHost: "palamedes-i18n.fr",
        acceptLanguageHeader: "de",
      })
    ).toStrictEqual({ locale: "fr", source: "tld" })
  })

  it("treats an unmapped tld (.com) as non-authoritative and uses the browser locale", () => {
    expect(
      tlded.resolve({
        strategy: "tld",
        requestHost: "palamedes-i18n.com",
        acceptLanguageHeader: "de",
      })
    ).toStrictEqual({ locale: "de", source: "accept-language" })
  })

  it("keeps a multilingual country tld (.ch) non-authoritative and expands the browser region", () => {
    // Switzerland has four official languages, so `.ch` cannot be authoritative;
    // the browser's `de-CH` expands to the supported base language `de`.
    expect(
      tlded.resolve({
        strategy: "tld",
        requestHost: "palamedes-i18n.ch",
        acceptLanguageHeader: "de-CH,de;q=0.9",
      })
    ).toStrictEqual({ locale: "de", source: "accept-language" })
  })

  it("falls back to the default locale for an unmapped tld without a browser preference", () => {
    expect(tlded.resolve({ strategy: "tld", requestHost: "palamedes-i18n.com" })).toStrictEqual({
      locale: "en",
      source: "default",
    })
  })

  it("treats a bare single-label host as having no tld", () => {
    expect(
      tlded.resolve({ strategy: "tld", requestHost: "localhost", acceptLanguageHeader: "de" })
    ).toStrictEqual({ locale: "de", source: "accept-language" })
  })

  it("falls back to the default locale when no host is given", () => {
    expect(tlded.resolve({ strategy: "tld" })).toStrictEqual({
      locale: "en",
      source: "default",
    })
  })

  it("builds switch urls by swapping the tld and keeping the path", () => {
    expect(
      tlded.canonicalUrl({
        locale: "fr",
        pathname: "/checkout",
        requestHost: "nextjs.palamedes-i18n.de",
        search: "?seat=1",
      })
    ).toBe("http://nextjs.palamedes-i18n.fr/checkout?seat=1")
  })

  it("routes the default locale to defaultTld (.com), which has no authoritative tld", () => {
    expect(
      tlded.canonicalUrl({
        locale: "en",
        pathname: "/",
        requestHost: "nextjs.palamedes-i18n.de",
      })
    ).toBe("http://nextjs.palamedes-i18n.com/")
  })

  it("preserves the request port in switch urls", () => {
    expect(
      tlded.canonicalUrl({
        locale: "es",
        pathname: "/",
        requestHost: "palamedes-i18n.de:4013",
      })
    ).toBe("http://palamedes-i18n.es:4013/")
  })

  it("returns a bare path when no request host is available", () => {
    expect(tlded.canonicalUrl({ locale: "de", pathname: "/checkout", search: "?seat=1" })).toBe(
      "/checkout?seat=1"
    )
  })

  it("returns a bare path for a single-label host with no tld", () => {
    expect(
      tlded.canonicalUrl({ locale: "de", pathname: "/checkout", requestHost: "localhost" })
    ).toBe("/checkout")
  })

  it("raises no host banner when the tld matches the rendered locale", () => {
    expect(
      tlded.suggest({
        acceptLanguageHeader: "de",
        currentLocale: "de",
        pathname: "/",
        requestHost: "palamedes-i18n.de:4013",
      })
    ).toBeNull()
  })

  it("surfaces a host banner when the tld and the rendered locale disagree", () => {
    const suggestion = tlded.suggest({
      currentLocale: "de",
      pathname: "/",
      requestHost: "nextjs.palamedes-i18n.fr",
    })
    expect(suggestion?.reason).toBe("host")
    expect(suggestion?.recommendedLocale).toBe("fr")
    expect(suggestion?.recommendedUrl).toBe("http://nextjs.palamedes-i18n.fr/")
  })
})
