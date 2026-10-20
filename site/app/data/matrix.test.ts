import { describe, expect, it } from "vitest";

import { cellFor, FRAMEWORKS, STRATEGIES } from "./matrix";

const PUBLIC_FRAMEWORKS = ["nextjs", "tanstack", "solid", "waku", "react-router", "remix"];
const TLD_LINKS = [
  ["en", "com"],
  ["de", "de"],
  ["es", "es"],
  ["fr", "fr"],
] as const;

describe("public framework matrix", () => {
  it("publishes exactly six live framework families across every strategy", () => {
    const liveFrameworks = FRAMEWORKS.filter(({ slug: framework }) =>
      STRATEGIES.every(({ slug: strategy }) => cellFor(framework, strategy).status === "live"),
    ).map(({ slug }) => slug);

    expect(liveFrameworks).toEqual(PUBLIC_FRAMEWORKS);

    for (const framework of PUBLIC_FRAMEWORKS) {
      expect(cellFor(framework, "cookie").demoLinks).toEqual([
        { label: "open", href: `https://${framework}-cookie.examples.palamedes.dev` },
      ]);
      expect(cellFor(framework, "route").demoLinks).toEqual(
        ["en", "de", "es", "fr"].map((locale) => ({
          label: locale,
          href: `https://${framework}-route.examples.palamedes.dev/${locale}`,
        })),
      );
      expect(cellFor(framework, "subdomain").demoLinks).toEqual(
        ["en", "de", "es", "fr"].map((locale) => ({
          label: locale,
          href: `https://${locale}.${framework}-subdomain.examples.palamedes.dev`,
        })),
      );
      expect(cellFor(framework, "tld").demoLinks).toEqual(
        TLD_LINKS.map(([label, tld]) => ({
          label,
          href: `https://${framework}.examples.palamedes-i18n.${tld}`,
        })),
      );
    }
  });

  it("keeps source links alongside every live demo", () => {
    for (const { slug: framework } of FRAMEWORKS) {
      for (const { slug: strategy } of STRATEGIES) {
        expect(cellFor(framework, strategy).sourceHref).toBe(
          `https://github.com/sebastian-software/palamedes/tree/main/examples/${framework}-${strategy}`,
        );
      }
    }
  });
});
