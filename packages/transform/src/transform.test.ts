import { transformPalamedesMacros } from "./transform"

type SourceMapLike = {
  file?: string
  mappings?: string
  sources?: string[]
  sourcesContent?: Array<string | null>
  version?: number
}

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
    expect(result.code).toContain("{ name }")
    expect(result.code).toContain('message: "Hello {name}"')
    expect(result.code).toContain('import { getI18n } from "@palamedes/runtime"')
    expect(result.code).not.toContain("@palamedes/core/macro")
    expect(result.compiledIds).toHaveLength(1)
    const map = normalizeSourceMap(result.map)
    expect(map).toMatchObject({
      version: 3,
      sources: ["test.ts"],
      sourcesContent: [code],
      file: "test.ts",
    })
    expect(map.mappings).not.toBe("")
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

  it("forwards descriptor macro values object literals", () => {
    const code = `
import { t } from "@palamedes/core/macro";
const msg = t({ message: "Hello {name}" }, { name });
`
    const result = transformPalamedesMacros(code, "test.ts")

    expect(result.code).toContain('message: "Hello {name}"')
    expect(result.code).toContain("{ name }")
  })

  it("rejects descriptor macro values missing message placeholders", () => {
    const code = `
import { t } from "@palamedes/core/macro";
const msg = t({ message: "Hello {name}" }, { naem: user.name });
`

    expect(() => transformPalamedesMacros(code, "test.ts")).toThrow(/Missing value\(s\): name/)
  })

  it("rejects descriptor macro values not used by the message", () => {
    const code = `
import { t } from "@palamedes/core/macro";
const msg = t({ message: "Hello" }, { name });
`

    expect(() => transformPalamedesMacros(code, "test.ts")).toThrow(/extra value\(s\): name/)
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
    expect(result.code).not.toContain("getI18n()._")
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
    expect(result.code).toContain('message={"Hello {name}"}')
    expect(result.code).toContain("values={{ name }}")
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
    expect(result.code).toContain('message={"Hallo Welt"}')
    const map = normalizeSourceMap(result.map)
    expect(map).toMatchObject({
      version: 3,
      sources: ["test.tsx"],
      sourcesContent: [code],
      file: "test.tsx",
    })
    expect(map.mappings).not.toBe("")
  })

  it("transforms Solid <Trans> macros to @palamedes/solid imports", () => {
    const code = `
import { Trans } from "@palamedes/solid/macro";
const el = <Trans>Hello <strong>{name}</strong></Trans>;
`
    const result = transformPalamedesMacros(code, "test.tsx")

    expect(result.code).toContain('import { Trans } from "@palamedes/solid"')
    expect(result.code).toContain('<Trans id="')
    expect(result.code).toContain('message={"Hello <0>{name}</0>"}')
    expect(result.code).toContain("components={{ 0: (children) => <strong>{children}</strong> }}")
  })

  it("deduplicates same-tag component placeholders", () => {
    const code = `
import { Trans } from "@palamedes/react/macro";
const el = <Trans>Accept <a href="/terms">terms</a> and <a href="/privacy">privacy</a></Trans>;
`
    const result = transformPalamedesMacros(code, "test.tsx")

    expect(result.code).toContain('message={"Accept <0>terms</0> and <1>privacy</1>"}')
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

    expect(result.code).toContain('message={"<0>A</0> and <1>B</1>"}')
    expect(result.code).toContain("components={{ 0: <strong />, 1: <strong /> }}")
  })

  it("uses Lingui-compatible self-closing placeholders for empty rich-text children", () => {
    const code = `
import { Trans } from "@palamedes/react/macro";
const el = <Trans>I agree to the <a href={COMMERCIAL_TERMS_URL}>Commercial Terms <ExternalLink className="inline" /></a></Trans>;
`
    const result = transformPalamedesMacros(code, "test.tsx")

    expect(result.code).toContain('message={"I agree to the <0>Commercial Terms<1/></0>"}')
    expect(result.code).toContain(
      'components={{ 0: <a href={COMMERCIAL_TERMS_URL} />, 1: <ExternalLink className="inline" /> }}'
    )
  })

  it("preserves inline whitespace before self-closing placeholders with trailing text", () => {
    const code = `
import { Trans } from "@palamedes/react/macro";
const el = <Trans>Foo <Icon /> bar</Trans>;
`
    const result = transformPalamedesMacros(code, "test.tsx")

    expect(result.code).toContain('message={"Foo <0/> bar"}')
  })

  it("normalizes rich-text placeholder boundary whitespace", () => {
    const code = `
import { Trans } from "@palamedes/react/macro";
const helper = <Trans>Reach out to your {" "}<a href="/advisor">advisor</a>{" "} for help.</Trans>;
const confirm = <Trans>Delete {" "}<strong>{selectedProjectName}</strong> ? This action cannot be undone.</Trans>;
const tailored = <Trans>
  Tailored to your {volume} MWh of annual electricity use in {countryName}
  .
</Trans>;
const literalBraces = <Trans>{"{name}"} .</Trans>;
`
    const result = transformPalamedesMacros(code, "test.tsx")

    expect(result.code).toContain('message={"Reach out to your <0>advisor</0> for help."}')
    expect(result.code).toContain(
      'message={"Delete <0>{selectedProjectName}</0>? This action cannot be undone."}'
    )
    expect(result.code).toContain(
      'message={"Tailored to your {volume} MWh of annual electricity use in {countryName}."}'
    )
    expect(result.code).toContain('message={"{name} ."}')
  })

  it("preserves leading separator spacing", () => {
    const code = `
import { Trans } from "@palamedes/react/macro";
const price = <Trans> · \${priceFormatted}/MWh</Trans>;
const manager = <Trans> — no manager</Trans>;
`
    const result = transformPalamedesMacros(code, "test.tsx")

    expect(result.code).toContain('message={" · ${priceFormatted}/MWh"}')
    expect(result.code).toContain('message={" — no manager"}')
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

  it("emits parseable JSX for <Trans> messages containing double quotes", () => {
    const code = `
import { Trans } from "@palamedes/react/macro";
export function Demo() {
  return <Trans>Upload settlement data file with "3Degrees Audit Summary" tab</Trans>;
}
`
    const result = transformPalamedesMacros(code, "test.tsx")

    expect(result.code).toContain(
      'message={"Upload settlement data file with \\\"3Degrees Audit Summary\\\" tab"}'
    )
    expect(result.code).not.toContain('message="Upload settlement data file with \\\"')
  })

  it("decodes JSX entities before deriving transformed Trans messages", () => {
    const code = `
import { Trans } from "@palamedes/react/macro";
const el = <Trans>Green-e&reg; applies to US &amp; Canada only</Trans>;
`
    const result = transformPalamedesMacros(code, "test.tsx")

    expect(result.code).toContain('message={"Green-e® applies to US & Canada only"}')
    expect(result.code).not.toContain("&amp;")
    expect(result.code).not.toContain("&reg;")
  })

  it("keeps JSX expression string entities raw", () => {
    const code = `
import { Trans } from "@palamedes/react/macro";
const child = <Trans>{"A &amp; B"}</Trans>;
const attr = <Trans message={"Literal &amp; Value"} />;
`
    const result = transformPalamedesMacros(code, "test.tsx")

    expect(result.code).toContain('message={"A &amp; B"}')
    expect(result.code).toContain('message={"Literal &amp; Value"}')
  })

  it("wraps JSX choice macro replacements when used as children", () => {
    const code = `
import { Plural } from "@palamedes/react/macro";
export function Demo({ totalRows }: { totalRows: number }) {
  return <p><Plural one="# row" other="# rows" value={totalRows} /></p>;
}
`
    const result = transformPalamedesMacros(code, "test.tsx")

    expect(result.code).toContain('<p>{getI18n()._("')
    expect(result.code).toContain('message: "{totalRows, plural, one {# row} other {# rows}}"')
    expect(result.code).toContain(")}</p>")
  })

  it("rejects nested JSX message macros", () => {
    const code = `
import { Plural, Trans } from "@palamedes/react/macro";
const el = <Trans><Plural value={contractCount} one="# contract" other="# contracts" /> ({capacityMW} MW)</Trans>;
`

    expect(() => transformPalamedesMacros(code, "test.tsx")).toThrow(
      /Nested i18n macro is not extractable as a single message at test\.tsx:3:\d+/
    )
  })

  it("keeps JSX choice macro replacements as expressions outside JSX children", () => {
    const code = `
import { Plural } from "@palamedes/react/macro";
const text = <Plural one="# row" other="# rows" value={totalRows} />;
`
    const result = transformPalamedesMacros(code, "test.tsx")

    expect(result.code).toContain('const text = getI18n()._("')
    expect(result.code).not.toContain("const text = {getI18n()._")
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

function normalizeSourceMap(map: unknown): SourceMapLike {
  if (typeof map === "string") {
    return JSON.parse(map) as SourceMapLike
  }

  if (map === null || map === undefined) {
    throw new Error("Expected transform to return a source map")
  }

  return map as SourceMapLike
}
