import { describe, expect, it } from "vitest"

import {
  EXAMPLE_MATRIX,
  selectBrowserExamples,
  selectExamples,
  selectScreenshotExamples,
} from "./example-matrix.mjs"
import { assertExampleMatrix } from "./example-matrix-guard.mjs"

function cloneMatrix() {
  return EXAMPLE_MATRIX.map((example) => ({ ...example }))
}

describe("example matrix guard", () => {
  it("accepts the canonical matrix", () => {
    expect(() => assertExampleMatrix(EXAMPLE_MATRIX)).not.toThrow()
  })

  it("rejects a whole-family typo with unchanged cardinality", () => {
    const matrix = cloneMatrix().map((example) =>
      example.framework === "nextjs" ? { ...example, framework: "next-js" } : example
    )

    expect(() => assertExampleMatrix(matrix)).toThrow(/server framework identities/)
  })

  it("rejects a whole-strategy typo with unchanged cardinality", () => {
    const matrix = cloneMatrix().map((example) =>
      example.strategy === "subdomain" ? { ...example, strategy: "sub-domain" } : example
    )

    expect(() => assertExampleMatrix(matrix)).toThrow(/server locale strategy identities/)
  })

  it("rejects a missing/replaced Cartesian pair with unchanged cardinality", () => {
    const matrix = cloneMatrix()
    const cookieIndex = matrix.findIndex(
      (example) => example.framework === "nextjs" && example.strategy === "cookie"
    )
    matrix[cookieIndex] = { ...matrix[cookieIndex], strategy: "route" }

    expect(() => assertExampleMatrix(matrix)).toThrow(/nextjs\/cookie/)
  })

  it("rejects duplicate ids and ports", () => {
    const duplicatedId = cloneMatrix()
    duplicatedId[1] = { ...duplicatedId[1], id: duplicatedId[0].id }
    expect(() => assertExampleMatrix(duplicatedId)).toThrow(/ids must be unique/)

    const duplicatedPort = cloneMatrix()
    duplicatedPort[1] = { ...duplicatedPort[1], port: duplicatedPort[0].port }
    expect(() => assertExampleMatrix(duplicatedPort)).toThrow(/ports must be unique/)
  })

  it("rejects a smoke check that omits or empties its document locale", () => {
    const omitted = cloneMatrix()
    const withChecks = omitted.findIndex((example) => example.smokeChecks.length > 0)
    omitted[withChecks] = {
      ...omitted[withChecks],
      smokeChecks: omitted[withChecks].smokeChecks.map(
        ({ htmlLang: _htmlLang, ...check }) => check
      ),
    }
    expect(() => assertExampleMatrix(omitted)).toThrow(/must declare htmlLang/)

    const emptied = cloneMatrix()
    emptied[withChecks] = {
      ...emptied[withChecks],
      smokeChecks: emptied[withChecks].smokeChecks.map((check) => ({ ...check, htmlLang: "" })),
    }
    expect(() => assertExampleMatrix(emptied)).toThrow(/must set htmlLang to a locale or null/)
  })

  it("keeps Vite as the single client-only browser proof", () => {
    const misplacedVite = cloneMatrix()
    const viteIndex = misplacedVite.findIndex((example) => example.id === "vite-mdx")
    misplacedVite[viteIndex] = { ...misplacedVite[viteIndex], strategy: "cookie" }

    expect(() => assertExampleMatrix(misplacedVite)).toThrow(
      /Vite must be the one client-only proof entry/
    )
  })

  it("keeps Vite in browser selection and out of screenshot selection", () => {
    expect(
      selectExamples({ framework: "vite", strategy: "client" }).map((example) => example.id)
    ).toEqual(["vite-mdx"])
    expect(selectBrowserExamples({ framework: "vite" }).map((example) => example.id)).toEqual([
      "vite-mdx",
    ])
    expect(selectScreenshotExamples({ framework: "vite" })).toEqual([])
  })
})
