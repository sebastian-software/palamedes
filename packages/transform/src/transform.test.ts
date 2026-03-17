import { transformLinguiMacros } from "./transform"

describe("transformLinguiMacros", () => {
  it("returns unchanged code without Lingui imports", () => {
    const code = `const x = 1;`
    const result = transformLinguiMacros(code, "test.ts")

    expect(result.hasChanged).toBe(false)
    expect(result.code).toBe(code)
  })

  it("transforms tagged templates into compact runtime lookups", () => {
    const code = `
import { t } from "@lingui/macro";
const msg = t\`Hello \${name}\`;
`
    const result = transformLinguiMacros(code, "test.ts")

    expect(result.hasChanged).toBe(true)
    expect(result.code).toContain('getI18n()._("')
    expect(result.code).toContain('{ name }')
    expect(result.code).toContain('message: "Hello {name}"')
    expect(result.code).toContain('import { getI18n } from "@palamedes/runtime"')
    expect(result.code).not.toContain('@lingui/macro')
  })

  it("transforms descriptor macros without preserving public ids", () => {
    const code = `
import { t } from "@lingui/macro";
const msg = t({ message: "Hello", context: "informal", comment: "A greeting" });
`
    const result = transformLinguiMacros(code, "test.ts")

    expect(result.code).toContain('getI18n()._("')
    expect(result.code).toContain('message: "Hello"')
    expect(result.code).toContain('context: "informal"')
    expect(result.code).toContain('comment: "A greeting"')
    expect(result.code).not.toContain('id: "greeting"')
  })

  it("transforms defineMessage to a descriptor with an internal lookup key", () => {
    const code = `
import { defineMessage } from "@lingui/macro";
const msg = defineMessage({ message: "Hello" });
`
    const result = transformLinguiMacros(code, "test.ts")

    expect(result.hasChanged).toBe(true)
    expect(result.code).toContain('id: "')
    expect(result.code).toContain('message: "Hello"')
    expect(result.code).not.toContain('getI18n()._')
  })

  it("transforms <Trans> with generated internal ids", () => {
    const code = `
import { Trans } from "@lingui/react/macro";
const el = <Trans>Hello {name}</Trans>;
`
    const result = transformLinguiMacros(code, "test.tsx")

    expect(result.code).toContain('<Trans id="')
    expect(result.code).toContain('message="Hello {name}"')
    expect(result.code).toContain('values={{ name }}')
  })

  it("strips the message field when requested", () => {
    const code = `
import { t } from "@lingui/macro";
const msg = t({ message: "Hello" });
`
    const result = transformLinguiMacros(code, "test.ts", {
      stripMessageField: true,
    })

    expect(result.code).toContain('getI18n()._("')
    expect(result.code).not.toContain('message: "Hello"')
  })

  it("rejects explicit ids in macro authoring", () => {
    const code = `
import { t } from "@lingui/macro";
const msg = t({ id: "greeting", message: "Hello" });
`

    expect(() => transformLinguiMacros(code, "test.ts")).toThrow(/Explicit message ids/)
  })

  it("rejects explicit ids on <Trans>", () => {
    const code = `
import { Trans } from "@lingui/react/macro";
const el = <Trans id="greeting">Hello</Trans>;
`

    expect(() => transformLinguiMacros(code, "test.tsx")).toThrow(/Explicit message ids/)
  })
})
