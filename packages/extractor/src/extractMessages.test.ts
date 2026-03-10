import { parseSync } from "oxc-parser"
import { extractMessages } from "./extractMessages"
import { generateMessageId } from "@palamedes/core-node"

function extract(code: string) {
  const result = parseSync("test.tsx", code, { sourceType: "module" })
  return extractMessages(result.program, "test.tsx", code)
}

// Helper to generate expected ID (same as the extractor does)
function msgId(message: string, context = "") {
  return generateMessageId(message, context)
}

describe("extractMessages", () => {
  describe("JSX Trans", () => {
    it("extracts simple Trans", () => {
      const code = `
        import { Trans } from "@lingui/react/macro"
        const x = <Trans>Hello World</Trans>
      `
      const messages = extract(code)
      expect(messages).toHaveLength(1)
      expect(messages[0].id).toBe(msgId("Hello World"))
      expect(messages[0].message).toBe("Hello World")
    })

    it("extracts Trans with id", () => {
      const code = `
        import { Trans } from "@lingui/react/macro"
        const x = <Trans id="greeting">Hello World</Trans>
      `
      const messages = extract(code)
      expect(messages).toHaveLength(1)
      expect(messages[0].id).toBe("greeting")
      expect(messages[0].message).toBe("Hello World")
    })

    it("extracts Trans with interpolation", () => {
      const code = `
        import { Trans } from "@lingui/react/macro"
        const x = <Trans>Hello {name}</Trans>
      `
      const messages = extract(code)
      expect(messages).toHaveLength(1)
      expect(messages[0].id).toBe(msgId("Hello {name}"))
      expect(messages[0].message).toBe("Hello {name}")
    })

    it("extracts Trans with nested elements", () => {
      const code = `
        import { Trans } from "@lingui/react/macro"
        const x = <Trans>Hello <b>World</b></Trans>
      `
      const messages = extract(code)
      expect(messages).toHaveLength(1)
      expect(messages[0].id).toBe(msgId("Hello <0>World</0>"))
      expect(messages[0].message).toBe("Hello <0>World</0>")
    })

    it("extracts line numbers correctly", () => {
      const code = `import { Trans } from "@lingui/react/macro"
const x = <Trans>Line 2</Trans>
const y = <Trans>Line 3</Trans>`
      const messages = extract(code)
      expect(messages).toHaveLength(2)
      expect(messages[0].origin[1]).toBe(2)
      expect(messages[1].origin[1]).toBe(3)
    })
  })

  describe("JSX Plural", () => {
    it("extracts Plural", () => {
      const code = `
        import { Plural } from "@lingui/react/macro"
        const x = <Plural value={count} one="# item" other="# items" />
      `
      const messages = extract(code)
      expect(messages).toHaveLength(1)
      const expectedMsg = "{count, plural, one {# item} other {# items}}"
      expect(messages[0].id).toBe(msgId(expectedMsg))
      expect(messages[0].message).toBe(expectedMsg)
    })

    it("extracts Plural with offset", () => {
      const code = `
        import { Plural } from "@lingui/react/macro"
        const x = <Plural value={count} offset="1" one="# item" other="# items" />
      `
      const messages = extract(code)
      expect(messages).toHaveLength(1)
      expect(messages[0].message).toContain("offset:1")
    })
  })

  describe("JSX Select", () => {
    it("extracts Select", () => {
      const code = `
        import { Select } from "@lingui/react/macro"
        const x = <Select value={gender} male="He" female="She" other="They" />
      `
      const messages = extract(code)
      expect(messages).toHaveLength(1)
      const expectedMsg = "{gender, select, male {He} female {She} other {They}}"
      expect(messages[0].id).toBe(msgId(expectedMsg))
      expect(messages[0].message).toBe(expectedMsg)
    })
  })

  describe("JS t tagged template", () => {
    it("extracts t`...`", () => {
      const code = `
        import { t } from "@lingui/core/macro"
        const x = t\`Hello World\`
      `
      const messages = extract(code)
      expect(messages).toHaveLength(1)
      expect(messages[0].id).toBe(msgId("Hello World"))
      expect(messages[0].message).toBe("Hello World")
    })

    it("extracts t with interpolation", () => {
      const code = `
        import { t } from "@lingui/core/macro"
        const x = t\`Hello \${name}\`
      `
      const messages = extract(code)
      expect(messages).toHaveLength(1)
      expect(messages[0].id).toBe(msgId("Hello {name}"))
      expect(messages[0].message).toBe("Hello {name}")
    })
  })

  describe("JS t call expression", () => {
    it("extracts t({...})", () => {
      const code = `
        import { t } from "@lingui/core/macro"
        const x = t({ id: "greeting", message: "Hello" })
      `
      const messages = extract(code)
      expect(messages).toHaveLength(1)
      expect(messages[0].id).toBe("greeting")
      expect(messages[0].message).toBe("Hello")
    })
  })

  describe("JS defineMessage", () => {
    it("extracts defineMessage({...})", () => {
      const code = `
        import { defineMessage } from "@lingui/core/macro"
        const msg = defineMessage({ id: "greeting", message: "Hello {name}" })
      `
      const messages = extract(code)
      expect(messages).toHaveLength(1)
      expect(messages[0].id).toBe("greeting")
      expect(messages[0].message).toBe("Hello {name}")
    })
  })

  describe("JS plural/select", () => {
    it("extracts plural()", () => {
      const code = `
        import { plural } from "@lingui/core/macro"
        const x = plural(count, { one: "# item", other: "# items" })
      `
      const messages = extract(code)
      expect(messages).toHaveLength(1)
      const expectedMsg = "{count, plural, one {# item} other {# items}}"
      expect(messages[0].id).toBe(msgId(expectedMsg))
      expect(messages[0].message).toBe(expectedMsg)
    })

    it("extracts select()", () => {
      const code = `
        import { select } from "@lingui/core/macro"
        const x = select(gender, { male: "He", female: "She", other: "They" })
      `
      const messages = extract(code)
      expect(messages).toHaveLength(1)
      const expectedMsg = "{gender, select, male {He} female {She} other {They}}"
      expect(messages[0].id).toBe(msgId(expectedMsg))
      expect(messages[0].message).toBe(expectedMsg)
    })
  })

  describe("useLingui hook", () => {
    it("extracts from destructured t", () => {
      const code = `
        import { useLingui } from "@lingui/react/macro"
        function MyComponent() {
          const { t } = useLingui()
          return t\`Hello World\`
        }
      `
      const messages = extract(code)
      expect(messages).toHaveLength(1)
      expect(messages[0].id).toBe(msgId("Hello World"))
      expect(messages[0].message).toBe("Hello World")
    })

    it("extracts from renamed destructured t", () => {
      const code = `
        import { useLingui } from "@lingui/react/macro"
        function MyComponent() {
          const { t: translate } = useLingui()
          return translate\`Hello World\`
        }
      `
      const messages = extract(code)
      expect(messages).toHaveLength(1)
      expect(messages[0].id).toBe(msgId("Hello World"))
      expect(messages[0].message).toBe("Hello World")
    })

    it("extracts t with interpolation from useLingui", () => {
      const code = `
        import { useLingui } from "@lingui/react/macro"
        function MyComponent() {
          const { t } = useLingui()
          return t\`Hello \${name}\`
        }
      `
      const messages = extract(code)
      expect(messages).toHaveLength(1)
      expect(messages[0].id).toBe(msgId("Hello {name}"))
      expect(messages[0].message).toBe("Hello {name}")
    })

    it("extracts t call expression from useLingui", () => {
      const code = `
        import { useLingui } from "@lingui/react/macro"
        function MyComponent() {
          const { t } = useLingui()
          return t({ id: "greeting", message: "Hello" })
        }
      `
      const messages = extract(code)
      expect(messages).toHaveLength(1)
      expect(messages[0].id).toBe("greeting")
      expect(messages[0].message).toBe("Hello")
    })
  })

  describe("multiple imports", () => {
    it("handles @lingui/macro imports", () => {
      const code = `
        import { Trans, t } from "@lingui/macro"
        const x = <Trans>Hello</Trans>
        const y = t\`World\`
      `
      const messages = extract(code)
      expect(messages).toHaveLength(2)
    })
  })

  describe("i18n runtime calls", () => {
    it("extracts i18n._(string)", () => {
      const code = `
        const x = i18n._("greeting")
      `
      const messages = extract(code)
      expect(messages).toHaveLength(1)
      expect(messages[0].id).toBe("greeting")
    })

    it("extracts i18n._({...})", () => {
      const code = `
        const x = i18n._({ id: "greeting", message: "Hello" })
      `
      const messages = extract(code)
      expect(messages).toHaveLength(1)
      expect(messages[0].id).toBe("greeting")
      expect(messages[0].message).toBe("Hello")
    })

    it("extracts i18n._(id, values, descriptor)", () => {
      const code = `
        const x = i18n._("greeting", { name }, { message: "Hello {name}" })
      `
      const messages = extract(code)
      expect(messages).toHaveLength(1)
      expect(messages[0].id).toBe("greeting")
      expect(messages[0].message).toBe("Hello {name}")
    })

    it("extracts i18n.t tagged template", () => {
      const code = `
        const x = i18n.t\`Hello World\`
      `
      const messages = extract(code)
      expect(messages).toHaveLength(1)
      expect(messages[0].id).toBe("Hello World")
    })

    it("extracts this.i18n._()", () => {
      const code = `
        class Foo {
          render() {
            return this.i18n._("greeting")
          }
        }
      `
      const messages = extract(code)
      expect(messages).toHaveLength(1)
      expect(messages[0].id).toBe("greeting")
    })

    it("extracts obj.i18n._()", () => {
      const code = `
        const x = ctx.i18n._("greeting")
      `
      const messages = extract(code)
      expect(messages).toHaveLength(1)
      expect(messages[0].id).toBe("greeting")
    })
  })

  describe("non-lingui code", () => {
    it("ignores non-lingui components", () => {
      const code = `
        import { Trans } from "some-other-library"
        const x = <Trans>Hello World</Trans>
      `
      const messages = extract(code)
      expect(messages).toHaveLength(0)
    })

    it("returns empty array for files without lingui imports", () => {
      const code = `
        const x = "Hello World"
      `
      const messages = extract(code)
      expect(messages).toHaveLength(0)
    })
  })
})
