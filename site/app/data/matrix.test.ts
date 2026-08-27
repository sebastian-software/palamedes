import { describe, expect, it } from "vitest"

import { cellFor, FRAMEWORKS } from "./matrix"

const PUBLIC_TLD_FRAMEWORKS = ["nextjs", "tanstack", "solid", "waku", "react-router"]
const TLD_LINKS = [
  ["en", "com"],
  ["de", "de"],
  ["es", "es"],
  ["fr", "fr"],
] as const

describe("public framework matrix", () => {
  it("publishes every browser-capable framework tld target while hosting is provisioning", () => {
    for (const framework of PUBLIC_TLD_FRAMEWORKS) {
      const cell = cellFor(framework, "tld")

      expect(cell.status).toBe("provisioning")
      expect(cell.demoLinks).toEqual(
        TLD_LINKS.map(([label, tld]) => ({
          label,
          href: `https://${framework}.examples.palamedes-i18n.${tld}`,
        }))
      )
    }
  })

  it("keeps Remix as a source-only proof surface", () => {
    expect(FRAMEWORKS.map(({ slug }) => slug)).toContain("remix")
    expect(cellFor("remix", "tld").demoLinks).toBeUndefined()
  })
})
