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
