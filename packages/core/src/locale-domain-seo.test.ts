import { describe, expect, it } from "vitest";
import { defineLocaleControls } from "./locale";

const domains = defineLocaleControls({
  locales: ["en", "de"] as const,
  defaultLocale: "en",
  protocol: "https",
  hosts: { mode: "domain", locales: { en: "product.example", de: "mein-produkt.de" } },
});

describe("domain locale controls", () => {
  it("uses the configured domain before browser language, without a path prefix", () => {
    expect(
      domains.resolve({
        strategy: "domain",
        requestHost: "MEIN-PRODUKT.DE:443",
        acceptLanguageHeader: "en",
      }),
    ).toStrictEqual({ locale: "de", source: "host" });
    expect(
      domains.canonicalUrl({
        locale: "de",
        pathname: "/pricing",
        search: "?plan=team",
        requestHost: "product.example:5173",
      }),
    ).toBe("https://mein-produkt.de/pricing?plan=team");
  });

  it("falls back to browser preference on unknown preview hosts", () => {
    expect(
      domains.resolve({
        strategy: "domain",
        requestHost: "preview.example",
        acceptLanguageHeader: "de-CH",
      }),
    ).toStrictEqual({ locale: "de", source: "accept-language" });
    expect(domains.resolve({ strategy: "domain", requestHost: "preview.example" })).toStrictEqual({
      locale: "en",
      source: "default",
    });
  });

  it("keeps explicit destination ports and supports non-DNS locale identifiers", () => {
    const local = defineLocaleControls({
      locales: ["en", "experiment=v2"] as const,
      defaultLocale: "en",
      labels: { "experiment=v2": "Experiment" },
      hosts: {
        mode: "domain",
        locales: { en: "english.localhost:4100", "experiment=v2": "preview.localhost:4200" },
      },
    });
    expect(
      local.canonicalUrl({
        locale: "experiment=v2",
        pathname: "/",
        requestHost: "english.localhost:4100",
      }),
    ).toBe("//preview.localhost:4200/");
  });

  it("uses the mapped destination for host and preference suggestions", () => {
    expect(
      domains.suggest({
        currentLocale: "en",
        requestHost: "mein-produkt.de",
        pathname: "/pricing",
      }),
    ).toMatchObject({
      reason: "host",
      recommendedLocale: "de",
      recommendedUrl: "https://mein-produkt.de/pricing",
    });
    expect(
      domains.suggest({
        currentLocale: "en",
        requestHost: "product.example",
        pathname: "/pricing",
        acceptLanguageHeader: "de",
      }),
    ).toMatchObject({
      reason: "accept-language",
      recommendedUrl: "https://mein-produkt.de/pricing",
    });
  });

  it("rejects incomplete or ambiguous maps before generating URLs", () => {
    expect(() =>
      defineLocaleControls({
        locales: ["en", "de"],
        defaultLocale: "en",
        hosts: { mode: "domain", locales: { en: "product.example" } },
      }),
    ).toThrow("hosts.locales.de is required");
    expect(() =>
      defineLocaleControls({
        locales: ["en", "de"],
        defaultLocale: "en",
        hosts: {
          mode: "domain",
          locales: { en: "product.example:4100", de: "PRODUCT.EXAMPLE:4200" },
        },
      }),
    ).toThrow("distinct locales");
    expect(() =>
      defineLocaleControls({
        locales: ["en"],
        defaultLocale: "en",
        hosts: { mode: "domain", locales: { en: "https://product.example" } },
      }),
    ).toThrow("DNS hostname");
  });

  it("keeps the existing host-map mode as a route-prefix strategy", () => {
    const previous = defineLocaleControls({
      locales: ["en", "de"],
      defaultLocale: "en",
      hosts: { locales: { de: "mein-produkt.de" } },
    });
    expect(previous.canonicalUrl({ locale: "de", pathname: "/pricing" })).toBe(
      "//mein-produkt.de/de/pricing",
    );
    expect(() => previous.resolve({ strategy: "domain", requestHost: "mein-produkt.de" })).toThrow(
      'requires hosts.mode "domain"',
    );
  });
});

describe("locale SEO links", () => {
  it("derives the canonical, every configured alternate, and the default from one domain map", () => {
    expect(domains.seoLinks({ locale: "de", pathname: "/pricing" })).toStrictEqual([
      { href: "https://mein-produkt.de/pricing", rel: "canonical" },
      { href: "https://product.example/pricing", hrefLang: "en", rel: "alternate" },
      { href: "https://mein-produkt.de/pricing", hrefLang: "de", rel: "alternate" },
      { href: "https://product.example/pricing", hrefLang: "x-default", rel: "alternate" },
    ]);
  });

  it("supports an explicit or omitted x-default", () => {
    expect(
      domains.seoLinks({ locale: "en", pathname: "/", xDefaultLocale: "de" }).at(-1),
    ).toStrictEqual({ href: "https://mein-produkt.de/", hrefLang: "x-default", rel: "alternate" });
    expect(domains.seoLinks({ locale: "en", pathname: "/", xDefaultLocale: false })).toHaveLength(
      3,
    );
  });

  it.each([
    { hosts: undefined, requestHost: undefined, expected: "/de/pricing?plan=team" },
    {
      hosts: { mode: "subdomain" as const },
      requestHost: "en.example.com",
      expected: "https://de.example.com/pricing?plan=team",
    },
    {
      hosts: { mode: "tld" as const, defaultTld: "com", tld: { com: "en" } },
      requestHost: "oss.example.com",
      expected: "https://oss.example.de/pricing?plan=team",
    },
  ])("uses the same URL policy for $expected", ({ hosts, requestHost, expected }) => {
    const controls = defineLocaleControls({
      locales: ["en", "de"],
      defaultLocale: "en",
      protocol: "https",
      hosts,
    });
    expect(
      controls.seoLinks({
        locale: "de",
        pathname: "/pricing",
        search: "?plan=team",
        requestHost,
      })[0],
    ).toStrictEqual({ href: expected, rel: "canonical" });
  });

  it("rejects unsupported SEO locales at the JavaScript boundary", () => {
    // @ts-expect-error Exercise untyped JavaScript callers.
    expect(() => domains.seoLinks({ locale: "fr", pathname: "/" })).toThrow("SEO locale");
    // @ts-expect-error Exercise untyped JavaScript callers.
    expect(() => domains.seoLinks({ locale: "en", pathname: "/", xDefaultLocale: "fr" })).toThrow(
      "SEO xDefaultLocale",
    );
    // @ts-expect-error Exercise untyped JavaScript callers.
    expect(() => domains.canonicalUrl({ locale: "fr", pathname: "/" })).toThrow(
      "configured locale host",
    );
  });
});
