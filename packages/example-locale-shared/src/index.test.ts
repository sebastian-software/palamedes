import { describe, expect, it } from "vitest"
import {
  buildCanonicalUrl,
  createRouteLocaleBanner,
  extractLocaleFromPath,
  getPreferredLocale,
  parseCookieLocale,
  replaceLocaleInPath,
  resolveCookieLocale,
  resolveHostLocale,
} from "./index"

describe("example locale shared", () => {
  it("parses cookie locale", () => {
    expect(parseCookieLocale("foo=bar; locale=de")).toBe("de")
    expect(parseCookieLocale("foo=bar")).toBeNull()
  })

  it("prefers supported accept-language entries", () => {
    expect(getPreferredLocale("fr-CA, de;q=0.9, en;q=0.8")).toBe("de")
    expect(getPreferredLocale("it, fr")).toBe("en")
  })

  it("resolves cookie locale before accept-language", () => {
    expect(resolveCookieLocale({
      acceptLanguageHeader: "de",
      cookieHeader: "locale=es",
    })).toEqual({
      locale: "es",
      source: "cookie",
    })
  })

  it("extracts and replaces locale path segments", () => {
    expect(extractLocaleFromPath("/de/products")).toBe("de")
    expect(replaceLocaleInPath("/de/products", "es")).toBe("/es/products")
    expect(replaceLocaleInPath("/", "de")).toBe("/de")
  })

  it("resolves host locale and canonical urls", () => {
    const hostConfig = {
      locales: {
        de: "de.lvh.me:4100",
        en: "en.lvh.me:4100",
        es: "es.lvh.me:4100",
      },
    }

    expect(resolveHostLocale("de.lvh.me:4100", hostConfig)).toBe("de")
    expect(buildCanonicalUrl({
      hostConfig,
      locale: "es",
      pathname: "/de/docs",
      requestHost: "de.lvh.me:4100",
      search: "?probe=1",
    })).toBe("http://es.lvh.me:4100/es/docs?probe=1")
  })

  it("creates accept-language and host mismatch banners", () => {
    expect(createRouteLocaleBanner({
      acceptLanguageHeader: "de",
      currentLocale: "en",
      pathname: "/en",
    })?.recommendedLocale).toBe("de")

    expect(createRouteLocaleBanner({
      currentLocale: "en",
      hostConfig: {
        locales: {
          de: "de.lvh.me:4100",
          en: "en.lvh.me:4100",
        },
      },
      pathname: "/en",
      requestHost: "de.lvh.me:4100",
    })?.reason).toBe("host")
  })
})
