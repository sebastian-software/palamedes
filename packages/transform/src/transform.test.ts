import { transformPalamedesMacros } from "./transform"

describe("transformPalamedesMacros", () => {
  it("returns unchanged code without Palamedes macro imports", () => {
    const code = `const x = 1;`
    const result = transformPalamedesMacros(code, "test.ts")

    expect(result.hasChanged).toBe(false)
    expect(result.code).toBe(code)
    expect(result.map).toBeNull()
  })

  it("transforms tagged templates into compact runtime lookups", () => {
    const code = `
import { t } from "@palamedes/core/macro";
const msg = t\`Hello \${name}\`;
`
    const result = transformPalamedesMacros(code, "test.ts")

    expect(result.hasChanged).toBe(true)
    expect(result.code).toContain('getI18n()._("')
    expect(result.code).toContain('{ name }')
    expect(result.code).toContain('message: "Hello {name}"')
    expect(result.code).toContain('import { getI18n } from "@palamedes/runtime"')
    expect(result.code).not.toContain("@palamedes/core/macro")
    expect(result.compiledIds).toHaveLength(1)
    expect(result.map).toMatchObject({
      version: 3,
      sources: ["test.ts"],
      sourcesContent: [code],
      file: "test.ts",
    })
    expect(result.map?.mappings).not.toBe("")
  })

  it("preserves member expression values in tagged templates", () => {
    const code = `
import { t } from "@palamedes/core/macro";
const msg = t\`Locale \${resolved.locale}\`;
`
    const result = transformPalamedesMacros(code, "test.ts")

    expect(result.code).toContain('message: "Locale {locale}"')
    expect(result.code).toContain("{ locale: resolved.locale }")
  })

  it("transforms descriptor macros without preserving public ids", () => {
    const code = `
import { t } from "@palamedes/core/macro";
const msg = t({ message: "Hello", context: "informal", comment: "A greeting" });
`
    const result = transformPalamedesMacros(code, "test.ts")

    expect(result.code).toContain('getI18n()._("')
    expect(result.code).toContain('message: "Hello"')
    expect(result.code).toContain('context: "informal"')
    expect(result.code).toContain('comment: "A greeting"')
    expect(result.code).not.toContain('id: "greeting"')
  })

  it("transforms defineMessage to a descriptor with an internal lookup key", () => {
    const code = `
import { defineMessage } from "@palamedes/core/macro";
const msg = defineMessage({ message: "Hello" });
`
    const result = transformPalamedesMacros(code, "test.ts")

    expect(result.hasChanged).toBe(true)
    expect(result.code).toContain('id: "')
    expect(result.code).toContain('message: "Hello"')
    expect(result.code).not.toContain('getI18n()._')
    expect(result.compiledIds).toHaveLength(1)
  })

  it("transforms <Trans> with generated internal ids", () => {
    const code = `
import { Trans } from "@palamedes/react/macro";
const el = <Trans>Hello {name}</Trans>;
`
    const result = transformPalamedesMacros(code, "test.tsx")

    expect(result.code).toContain('import { Trans } from "@palamedes/react"')
    expect(result.code).toContain('<Trans id="')
    expect(result.code).toContain('message="Hello {name}"')
    expect(result.code).toContain('values={{ name }}')
  })

  it("applies native UTF-8 byte edit offsets to JavaScript strings", () => {
    const code = `import { Trans } from "@palamedes/react/macro";
const x = "äöü";
const y = <Trans>Hallo Welt</Trans>;
`
    const result = transformPalamedesMacros(code, "test.tsx")

    expect(result.hasChanged).toBe(true)
    expect(result.code).toContain('import { Trans } from "@palamedes/react"')
    expect(result.code).toContain('const x = "äöü";')
    expect(result.code).toContain('message="Hallo Welt"')
    expect(result.map).toMatchObject({
      version: 3,
      sources: ["test.tsx"],
      sourcesContent: [code],
      file: "test.tsx",
    })
    expect(result.map?.mappings).not.toBe("")
  })

  it("transforms Solid <Trans> macros to @palamedes/solid imports", () => {
    const code = `
import { Trans } from "@palamedes/solid/macro";
const el = <Trans>Hello <strong>{name}</strong></Trans>;
`
    const result = transformPalamedesMacros(code, "test.tsx")

    expect(result.code).toContain('import { Trans } from "@palamedes/solid"')
    expect(result.code).toContain('<Trans id="')
    expect(result.code).toContain('message="Hello <0>{name}</0>"')
    expect(result.code).toContain(
      'components={{ 0: (children) => <strong>{children}</strong> }}'
    )
  })

  it("deduplicates same-tag component placeholders", () => {
    const code = `
import { Trans } from "@palamedes/react/macro";
const el = <Trans>Accept <a href="/terms">terms</a> and <a href="/privacy">privacy</a></Trans>;
`
    const result = transformPalamedesMacros(code, "test.tsx")

    expect(result.code).toContain('message="Accept <0>terms</0> and <1>privacy</1>"')
    expect(result.code).toContain(
      'components={{ 0: <a href="/terms" />, 1: <a href="/privacy" /> }}'
    )
  })

  it("deduplicates same-tag component placeholders with identical markup", () => {
    const code = `
import { Trans } from "@palamedes/react/macro";
const el = <Trans><strong>A</strong> and <strong>B</strong></Trans>;
`
    const result = transformPalamedesMacros(code, "test.tsx")

    expect(result.code).toContain(
      'message="<0>A</0> and <1>B</1>"'
    )
    expect(result.code).toContain(
      "components={{ 0: <strong />, 1: <strong /> }}"
    )
  })

  it("strips the message field when requested", () => {
    const code = `
import { t } from "@palamedes/core/macro";
const msg = t({ message: "Hello" });
`
    const result = transformPalamedesMacros(code, "test.ts", {
      stripMessageField: true,
    })

    expect(result.code).toContain('getI18n()._("')
    expect(result.code).not.toContain('message: "Hello"')
  })

  it("rejects explicit ids in macro authoring", () => {
    const code = `
import { t } from "@palamedes/core/macro";
const msg = t({ id: "greeting", message: "Hello" });
`

    expect(() => transformPalamedesMacros(code, "test.ts")).toThrow(/Explicit message ids/)
  })

  it("rejects explicit ids on <Trans>", () => {
    const code = `
import { Trans } from "@palamedes/react/macro";
const el = <Trans id="greeting">Hello</Trans>;
`

    expect(() => transformPalamedesMacros(code, "test.tsx")).toThrow(/Explicit message ids/)
  })

  it("rejects unnamed template placeholders", () => {
    const code = `
import { t } from "@palamedes/core/macro";
const msg = t\`Hello \${firstName + lastName}\`;
`

    expect(() => transformPalamedesMacros(code, "test.ts")).toThrow(/stable placeholder name/)
  })

  it("rejects unnamed JSX placeholders", () => {
    const code = `
import { Trans } from "@palamedes/react/macro";
const el = <Trans>Hello {firstName + lastName}</Trans>;
`

    expect(() => transformPalamedesMacros(code, "test.tsx")).toThrow(/stable placeholder name/)
  })

  it("rejects unnamed choice value placeholders", () => {
    const code = `
import { plural } from "@palamedes/core/macro";
const msg = plural(count + 1, { one: "# item", other: "# items" });
`

    expect(() => transformPalamedesMacros(code, "test.ts")).toThrow(/stable placeholder name/)
  })

  it("leaves legacy Lingui macro imports untouched", () => {
    const code = `
import { t } from "@lingui/macro";
const msg = t\`Hello\`;
`

    const result = transformPalamedesMacros(code, "test.ts")

    expect(result.hasChanged).toBe(false)
    expect(result.code).toBe(code)
  })
})
