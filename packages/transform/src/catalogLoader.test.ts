import { describe, expect, it } from "vitest"

import {
  createCatalogLoaderResult,
  createCompileErrorMessage,
  createDiagnosticMessage,
  createMissingErrorMessage,
  renderCatalogModule,
  type CatalogCompileArtifactResult,
} from "./catalogLoader"

const baseResult: CatalogCompileArtifactResult = {
  messages: {
    greeting: "Hallo",
  },
  missing: [],
  diagnostics: [],
}

describe("catalog loader helpers", () => {
  it("renders catalog modules consistently", () => {
    expect(renderCatalogModule({ greeting: "Hallo" })).toBe(
      'export const messages={"greeting":"Hallo"};export default { messages };'
    )
  })

  it("formats missing translations with context", () => {
    expect(
      createMissingErrorMessage("de", [
        { sourceKey: { message: "Hello" } },
        { sourceKey: { message: "Open", context: "verb" } },
      ])
    ).toBe("Failed to compile catalog for locale de!\n\nMissing 2 translation(s):\nHello\nOpen [context: verb]")
  })

  it("formats diagnostics and compile errors with the same source key rendering", () => {
    const diagnostics = [
      {
        severity: "error" as const,
        code: "icu",
        message: "Broken ICU",
        sourceKey: { message: "Inbox", context: "nav" },
        locale: "de",
      },
    ]

    expect(createDiagnosticMessage("de", diagnostics)).toBe(
      "Catalog diagnostics for locale de:\n\n[error] icu (de)\nBroken ICU\nSource: Inbox [context: nav]"
    )
    expect(createCompileErrorMessage("de", diagnostics)).toBe(
      "Failed to compile catalog for locale de!\n\nCompilation error for 1 translation(s):\nBroken ICU\nCode: icu\nLocale: de\nSource: Inbox [context: nav]"
    )
  })

  it("fails missing translations outside the pseudo locale only when configured", () => {
    const result: CatalogCompileArtifactResult = {
      ...baseResult,
      missing: [{ sourceKey: { message: "Hello" } }],
    }

    expect(() =>
      createCatalogLoaderResult(result, {
        locale: "de",
        failOnMissing: true,
        missingFailureHint: "configured failOnMissing",
      })
    ).toThrow(/configured failOnMissing/)

    expect(
      createCatalogLoaderResult(result, {
        locale: "pseudo",
        pseudoLocale: "pseudo",
        failOnMissing: true,
      }).code
    ).toBe(renderCatalogModule(baseResult.messages))
  })

  it("fails compile diagnostics or emits warnings depending on configuration", () => {
    const result: CatalogCompileArtifactResult = {
      ...baseResult,
      diagnostics: [
        {
          severity: "error",
          code: "icu",
          message: "Broken ICU",
          sourceKey: { message: "Inbox" },
          locale: "de",
        },
      ],
    }

    expect(() =>
      createCatalogLoaderResult(result, {
        locale: "de",
        failOnCompileError: true,
        compileFailureHint: "configured failOnCompileError",
      })
    ).toThrow(/configured failOnCompileError/)

    expect(
      createCatalogLoaderResult(result, {
        locale: "de",
        diagnosticsWarningHint: "warning hint",
      }).warnings
    ).toEqual([
      "Catalog diagnostics for locale de:\n\n[error] icu (de)\nBroken ICU\nSource: Inbox\n\nwarning hint",
    ])
  })
})
