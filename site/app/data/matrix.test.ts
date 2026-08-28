import { describe, expect, it } from "vitest"

import { cellFor, FRAMEWORKS, STRATEGIES } from "./matrix"

const PUBLIC_FRAMEWORKS = ["nextjs", "tanstack", "solid", "waku", "react-router"]
const TLD_LINKS = [
  ["en", "com"],
  ["de", "de"],
  ["es", "es"],
  ["fr", "fr"],
] as const

describe("public framework matrix", () => {
  it("publishes exactly five live framework families across every strategy", () => {
    const liveFrameworks = FRAMEWORKS.filter(({ slug: framework }) =>
      STRATEGIES.every(({ slug: strategy }) => cellFor(framework, strategy).status === "live")
    ).map(({ slug }) => slug)

    expect(liveFrameworks).toEqual(PUBLIC_FRAMEWORKS)

    for (const framework of PUBLIC_FRAMEWORKS) {
      expect(cellFor(framework, "cookie").demoLinks).toEqual([
        { label: "open", href: `https://${framework}-cookie.examples.palamedes.dev` },
      ])
      expect(cellFor(framework, "route").demoLinks).toEqual(
        ["en", "de", "es"].map((locale) => ({
          label: locale,
          href: `https://${framework}-route.examples.palamedes.dev/${locale}`,
        }))
      )
      expect(cellFor(framework, "subdomain").demoLinks).toEqual(
        ["en", "de", "es"].map((locale) => ({
          label: locale,
          href: `https://${locale}.${framework}-subdomain.examples.palamedes.dev`,
        }))
      )
      expect(cellFor(framework, "tld").demoLinks).toEqual(
        TLD_LINKS.map(([label, tld]) => ({
          label,
          href: `https://${framework}.examples.palamedes-i18n.${tld}`,
        }))
      )
    }
  })

  it("keeps Remix as a source-only proof surface", () => {
    expect(FRAMEWORKS.map(({ slug }) => slug)).toContain("remix")

    for (const { slug: strategy } of STRATEGIES) {
      const cell = cellFor("remix", strategy)

      expect(cell.status).toBe("provisioning")
      expect(cell.demoLinks).toBeUndefined()
      expect(cell.sourceHref).toBe(
        `https://github.com/sebastian-software/palamedes/tree/main/examples/remix-${strategy}`
      )
    }
  })
})
