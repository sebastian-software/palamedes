import { transformLinguiMacros } from "./transform"

describe("transformLinguiMacros", () => {
  describe("detection", () => {
    it("should return unchanged code if no Lingui imports", () => {
      const code = `const x = 1;`
      const result = transformLinguiMacros(code, "test.ts")

      expect(result.hasChanged).toBe(false)
      expect(result.code).toBe(code)
    })

    it("should detect @lingui/macro imports", () => {
      const code = `
import { t } from "@lingui/macro";
const msg = t\`Hello\`;
`
      const result = transformLinguiMacros(code, "test.ts")

      expect(result.hasChanged).toBe(true)
    })

    it("should detect @lingui/core/macro imports", () => {
      const code = `
import { t } from "@lingui/core/macro";
const msg = t\`Hello\`;
`
      const result = transformLinguiMacros(code, "test.ts")

      expect(result.hasChanged).toBe(true)
    })

    it("should detect @lingui/react/macro imports", () => {
      const code = `
import { t } from "@lingui/react/macro";
const msg = t\`Hello\`;
`
      const result = transformLinguiMacros(code, "test.ts")

      expect(result.hasChanged).toBe(true)
    })
  })

  describe("tagged template transform: t`...`", () => {
    it("should transform simple t`` to i18n._()", () => {
      const code = `
import { t } from "@lingui/macro";
const msg = t\`Hello\`;
`
      const result = transformLinguiMacros(code, "test.ts")

      expect(result.hasChanged).toBe(true)
      expect(result.code).toContain('i18n._({ id:')
      expect(result.code).toContain('message: "Hello"')
      expect(result.code).toContain('import { i18n } from "@lingui/core"')
      expect(result.code).not.toContain('@lingui/macro')
    })

    it("should transform t`` with interpolation", () => {
      const code = `
import { t } from "@lingui/macro";
const name = "World";
const msg = t\`Hello \${name}\`;
`
      const result = transformLinguiMacros(code, "test.ts")

      expect(result.hasChanged).toBe(true)
      expect(result.code).toContain('message: "Hello {name}"')
      expect(result.code).toContain('values: { name }')
    })

    it("should handle aliased imports", () => {
      const code = `
import { t as translate } from "@lingui/macro";
const msg = translate\`Hello\`;
`
      const result = transformLinguiMacros(code, "test.ts")

      expect(result.hasChanged).toBe(true)
      expect(result.code).toContain('i18n._(')
    })
  })

  describe("call expression transform: t({...})", () => {
    it("should transform t() with message descriptor", () => {
      const code = `
import { t } from "@lingui/macro";
const msg = t({ message: "Hello" });
`
      const result = transformLinguiMacros(code, "test.ts")

      expect(result.hasChanged).toBe(true)
      expect(result.code).toContain('i18n._({ id:')
      expect(result.code).toContain('message: "Hello"')
    })

    it("should transform t() with explicit id", () => {
      const code = `
import { t } from "@lingui/macro";
const msg = t({ id: "greeting", message: "Hello" });
`
      const result = transformLinguiMacros(code, "test.ts")

      expect(result.hasChanged).toBe(true)
      expect(result.code).toContain('id: "greeting"')
      expect(result.code).toContain('message: "Hello"')
    })

    it("should preserve context and comment", () => {
      const code = `
import { t } from "@lingui/macro";
const msg = t({ id: "greeting", message: "Hello", context: "informal", comment: "A greeting" });
`
      const result = transformLinguiMacros(code, "test.ts")

      expect(result.hasChanged).toBe(true)
      expect(result.code).toContain('context: "informal"')
      expect(result.code).toContain('comment: "A greeting"')
    })
  })

  describe("defineMessage transform", () => {
    it("should transform defineMessage() to object", () => {
      const code = `
import { defineMessage } from "@lingui/macro";
const msg = defineMessage({ message: "Hello" });
`
      const result = transformLinguiMacros(code, "test.ts")

      expect(result.hasChanged).toBe(true)
      // defineMessage should not add i18n._()
      expect(result.code).not.toContain('i18n._')
      // But should have the descriptor
      expect(result.code).toContain('id:')
      expect(result.code).toContain('message: "Hello"')
    })
  })

  describe("msg transform", () => {
    it("should transform msg`` like t``", () => {
      const code = `
import { msg } from "@lingui/macro";
const message = msg\`Hello\`;
`
      const result = transformLinguiMacros(code, "test.ts")

      expect(result.hasChanged).toBe(true)
      expect(result.code).toContain('i18n._({ id:')
      expect(result.code).toContain('message: "Hello"')
    })
  })

  describe("import management", () => {
    it("should remove macro imports", () => {
      const code = `
import { t, defineMessage } from "@lingui/macro";
const msg = t\`Hello\`;
`
      const result = transformLinguiMacros(code, "test.ts")

      expect(result.code).not.toContain('@lingui/macro')
    })

    it("should add runtime import if needed", () => {
      const code = `
import { t } from "@lingui/macro";
const msg = t\`Hello\`;
`
      const result = transformLinguiMacros(code, "test.ts")

      expect(result.code).toContain('import { i18n } from "@lingui/core"')
    })

    it("should use custom runtime module", () => {
      const code = `
import { t } from "@lingui/macro";
const msg = t\`Hello\`;
`
      const result = transformLinguiMacros(code, "test.ts", {
        runtimeModule: "./i18n",
      })

      expect(result.code).toContain('import { i18n } from "./i18n"')
    })

    it("should not add duplicate runtime import if already present", () => {
      const code = `
import { t } from "@lingui/macro";
import { i18n } from "@lingui/core";
const msg = t\`Hello\`;
`
      const result = transformLinguiMacros(code, "test.ts")

      // Should only have one i18n import
      const importMatches = result.code.match(/import.*i18n.*from.*@lingui\/core/g)
      expect(importMatches?.length).toBe(1)
    })
  })

  describe("options", () => {
    it("should strip message field when stripMessageField is true", () => {
      const code = `
import { t } from "@lingui/macro";
const msg = t({ id: "greeting", message: "Hello" });
`
      const result = transformLinguiMacros(code, "test.ts", {
        stripMessageField: true,
      })

      expect(result.code).toContain('id: "greeting"')
      expect(result.code).not.toContain('message:')
    })

    it("should strip context and comment when stripNonEssentialProps is true", () => {
      const code = `
import { t } from "@lingui/macro";
const msg = t({ id: "greeting", message: "Hello", context: "informal", comment: "A greeting" });
`
      const result = transformLinguiMacros(code, "test.ts", {
        stripNonEssentialProps: true,
      })

      expect(result.code).not.toContain('context:')
      expect(result.code).not.toContain('comment:')
    })
  })

  describe("plural macro transform", () => {
    it("should transform plural() to ICU format", () => {
      const code = `
import { plural } from "@lingui/macro";
const msg = plural(count, { one: "# item", other: "# items" });
`
      const result = transformLinguiMacros(code, "test.ts")

      expect(result.hasChanged).toBe(true)
      expect(result.code).toContain('i18n._({')
      expect(result.code).toContain('{count, plural, one {# item} other {# items}}')
      expect(result.code).toContain('values: { count }')
    })

    it("should handle plural with exact matches", () => {
      const code = `
import { plural } from "@lingui/macro";
const msg = plural(count, { _0: "No items", one: "# item", other: "# items" });
`
      const result = transformLinguiMacros(code, "test.ts")

      expect(result.hasChanged).toBe(true)
      expect(result.code).toContain('=0 {No items}')
      expect(result.code).toContain('one {# item}')
      expect(result.code).toContain('other {# items}')
    })
  })

  describe("select macro transform", () => {
    it("should transform select() to ICU format", () => {
      const code = `
import { select } from "@lingui/macro";
const msg = select(gender, { male: "He", female: "She", other: "They" });
`
      const result = transformLinguiMacros(code, "test.ts")

      expect(result.hasChanged).toBe(true)
      expect(result.code).toContain('i18n._({')
      expect(result.code).toContain('{gender, select,')
      expect(result.code).toContain('male {He}')
      expect(result.code).toContain('female {She}')
      expect(result.code).toContain('other {They}')
      expect(result.code).toContain('values: { gender }')
    })
  })

  describe("selectOrdinal macro transform", () => {
    it("should transform selectOrdinal() to ICU format", () => {
      const code = `
import { selectOrdinal } from "@lingui/macro";
const msg = selectOrdinal(count, { one: "#st", two: "#nd", few: "#rd", other: "#th" });
`
      const result = transformLinguiMacros(code, "test.ts")

      expect(result.hasChanged).toBe(true)
      expect(result.code).toContain('i18n._({')
      expect(result.code).toContain('{count, selectordinal,')
      expect(result.code).toContain('one {#st}')
      expect(result.code).toContain('other {#th}')
    })
  })

  describe("useLingui macro transform", () => {
    it("should transform useLingui() with t", () => {
      const code = `
import { useLingui } from "@lingui/react/macro";
function MyComponent() {
  const { t } = useLingui();
  return t\`Hello\`;
}
`
      const result = transformLinguiMacros(code, "test.tsx")

      expect(result.hasChanged).toBe(true)
      expect(result.code).toContain('const { _ } = useLingui()')
      expect(result.code).toContain('_({ id:')
      expect(result.code).toContain('message: "Hello"')
      expect(result.code).toContain('import { useLingui } from "@lingui/react"')
    })

    it("should transform useLingui() with plural", () => {
      const code = `
import { useLingui } from "@lingui/react/macro";
function MyComponent() {
  const { plural } = useLingui();
  return plural(count, { one: "# item", other: "# items" });
}
`
      const result = transformLinguiMacros(code, "test.tsx")

      expect(result.hasChanged).toBe(true)
      expect(result.code).toContain('const { _ } = useLingui()')
      expect(result.code).toContain('_({ id:')
      expect(result.code).toContain('{count, plural,')
      expect(result.code).toContain('values: { count }')
    })

    it("should transform useLingui() with multiple destructured functions", () => {
      const code = `
import { useLingui } from "@lingui/react/macro";
function MyComponent() {
  const { t, plural } = useLingui();
  const a = t\`Hello\`;
  const b = plural(n, { one: "#", other: "#" });
  return a + b;
}
`
      const result = transformLinguiMacros(code, "test.tsx")

      expect(result.hasChanged).toBe(true)
      expect(result.code).toContain('const { _ } = useLingui()')
      // Both should use _()
      expect(result.code.match(/_\(\{/g)?.length).toBe(2)
    })
  })

  describe("getLingui macro transform", () => {
    it("should transform getLingui() with t to i18n._()", () => {
      const code = `
import { getLingui } from "@lingui/core/macro";
async function ServerPage() {
  const { t } = getLingui();
  return t\`Hello\`;
}
`
      const result = transformLinguiMacros(code, "test.tsx")

      expect(result.hasChanged).toBe(true)
      // getLingui declaration should be removed
      expect(result.code).not.toContain("getLingui()")
      // Should use i18n._() instead of just _()
      expect(result.code).toContain('i18n._({ id:')
      expect(result.code).toContain('message: "Hello"')
      expect(result.code).toContain('import { i18n } from "@lingui/core"')
    })

    it("should transform getLingui() with plural to i18n._()", () => {
      const code = `
import { getLingui } from "@lingui/core/macro";
function ServerPage() {
  const { plural } = getLingui();
  return plural(count, { one: "# item", other: "# items" });
}
`
      const result = transformLinguiMacros(code, "test.tsx")

      expect(result.hasChanged).toBe(true)
      expect(result.code).not.toContain("getLingui()")
      expect(result.code).toContain('i18n._({ id:')
      expect(result.code).toContain('{count, plural,')
      expect(result.code).toContain('values: { count }')
    })

    it("should work with getLingui() in Server Components (async functions)", () => {
      const code = `
import { getLingui } from "@lingui/core/macro";

export default async function Page() {
  const { t, plural } = getLingui();
  const greeting = t\`Welcome\`;
  const items = plural(n, { one: "# result", other: "# results" });
  return <div>{greeting}: {items}</div>;
}
`
      const result = transformLinguiMacros(code, "test.tsx")

      expect(result.hasChanged).toBe(true)
      expect(result.code).not.toContain("getLingui()")
      // Both should use i18n._()
      expect(result.code.match(/i18n\._\(\{/g)?.length).toBe(2)
    })
  })

  describe("Trans component transform", () => {
    it("should transform simple <Trans>", () => {
      const code = `
import { Trans } from "@lingui/react/macro";
const el = <Trans>Hello World</Trans>;
`
      const result = transformLinguiMacros(code, "test.tsx")

      expect(result.hasChanged).toBe(true)
      // Trans macro transforms to Trans component from @lingui/react
      expect(result.code).toContain('<Trans')
      expect(result.code).toContain('message="Hello World"')
      expect(result.code).toContain('import { Trans } from "@lingui/react"')
    })

    it("should transform <Trans> with interpolation", () => {
      const code = `
import { Trans } from "@lingui/react/macro";
const el = <Trans>Hello {name}</Trans>;
`
      const result = transformLinguiMacros(code, "test.tsx")

      expect(result.hasChanged).toBe(true)
      expect(result.code).toContain('message="Hello {name}"')
      expect(result.code).toContain('values={{ name }}')
    })

    it("should transform <Trans> with explicit id", () => {
      const code = `
import { Trans } from "@lingui/react/macro";
const el = <Trans id="greeting">Hello</Trans>;
`
      const result = transformLinguiMacros(code, "test.tsx")

      expect(result.hasChanged).toBe(true)
      expect(result.code).toContain('id="greeting"')
    })

    it("should transform <Trans> with nested elements", () => {
      const code = `
import { Trans } from "@lingui/react/macro";
const el = <Trans>Hello <b>World</b></Trans>;
`
      const result = transformLinguiMacros(code, "test.tsx")

      expect(result.hasChanged).toBe(true)
      // Nested elements become <0>...</0>
      expect(result.code).toContain('<0>World</0>')
    })
  })

  describe("Plural component transform", () => {
    it("should transform <Plural> component", () => {
      const code = `
import { Plural } from "@lingui/react/macro";
const el = <Plural value={count} one="# item" other="# items" />;
`
      const result = transformLinguiMacros(code, "test.tsx")

      expect(result.hasChanged).toBe(true)
      expect(result.code).toContain('i18n._({')
      expect(result.code).toContain('{count, plural,')
      expect(result.code).toContain('one {# item}')
      expect(result.code).toContain('other {# items}')
    })
  })

  describe("Select component transform", () => {
    it("should transform <Select> component", () => {
      const code = `
import { Select } from "@lingui/react/macro";
const el = <Select value={gender} male="He" female="She" other="They" />;
`
      const result = transformLinguiMacros(code, "test.tsx")

      expect(result.hasChanged).toBe(true)
      expect(result.code).toContain('i18n._({')
      expect(result.code).toContain('{gender, select,')
      expect(result.code).toContain('male {He}')
    })
  })

  describe("source maps", () => {
    it("should generate source map by default", () => {
      const code = `
import { t } from "@lingui/macro";
const msg = t\`Hello\`;
`
      const result = transformLinguiMacros(code, "test.ts")

      expect(result.hasChanged).toBe(true)
      expect(result.map).toBeDefined()
      expect(result.map?.version).toBe(3)
      expect(result.map?.sources).toContain("test.ts")
      expect(result.map?.mappings).toBeTruthy()
    })

    it("should include source content in source map", () => {
      const code = `
import { t } from "@lingui/macro";
const msg = t\`Hello\`;
`
      const result = transformLinguiMacros(code, "test.ts")

      expect(result.map?.sourcesContent).toBeDefined()
      expect(result.map?.sourcesContent?.[0]).toBe(code)
    })

    it("should not generate source map when disabled", () => {
      const code = `
import { t } from "@lingui/macro";
const msg = t\`Hello\`;
`
      const result = transformLinguiMacros(code, "test.ts", {
        sourceMap: false,
      })

      expect(result.hasChanged).toBe(true)
      expect(result.map).toBeNull()
    })

    it("should return null map when no changes", () => {
      const code = `const x = 1;`
      const result = transformLinguiMacros(code, "test.ts")

      expect(result.hasChanged).toBe(false)
      expect(result.map).toBeNull()
    })
  })
})
