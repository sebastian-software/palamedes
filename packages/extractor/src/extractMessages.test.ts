import { parseSync } from "oxc-parser"

import { extractMessages } from "./extractMessages"

function extract(code: string) {
  const result = parseSync("test.tsx", code, { sourceType: "module" })
  return extractMessages(result.program, "test.tsx", code)
}

describe("extractMessages", () => {
  describe("JSX Trans", () => {
    it("extracts simple Trans", () => {
      const code = `
        import { Trans } from "@palamedes/react/macro"
        const x = <Trans>Hello World</Trans>
      `
      const messages = extract(code)
      expect(messages).toHaveLength(1)
      expect(messages[0].message).toBe("Hello World")
    })

    it("extracts Trans with interpolation", () => {
      const code = `
        import { Trans } from "@palamedes/react/macro"
        const x = <Trans>Hello {name}</Trans>
      `
      const messages = extract(code)
      expect(messages).toHaveLength(1)
      expect(messages[0].message).toBe("Hello {name}")
    })

    it("extracts Trans with nested elements", () => {
      const code = `
        import { Trans } from "@palamedes/react/macro"
        const x = <Trans>Hello <b>World</b></Trans>
      `
      const messages = extract(code)
      expect(messages).toHaveLength(1)
      expect(messages[0].message).toBe("Hello <b>World</b>")
    })

    it("deduplicates same-tag component placeholders with different props", () => {
      const code = `
        import { Trans } from "@palamedes/react/macro"
        const x = <Trans>Accept <a href="/terms">terms</a> and <a href="/privacy">privacy</a></Trans>
      `
      const messages = extract(code)
      expect(messages).toHaveLength(1)
      expect(messages[0].message).toBe("Accept <a>terms</a> and <a_1>privacy</a_1>")
    })

    it("extracts Solid Trans macros with the same semantics", () => {
      const code = `
        import { Trans } from "@palamedes/solid/macro"
        const x = <Trans>Hello {name}</Trans>
      `
      const messages = extract(code)
      expect(messages).toHaveLength(1)
      expect(messages[0].message).toBe("Hello {name}")
    })
  })

  describe("macro calls", () => {
    it("extracts descriptor messages", () => {
      const code = `
        import { defineMessage, t } from "@palamedes/core/macro"
        const one = t({ message: "Hello" })
        const two = defineMessage({ message: "Hello {name}", context: "email.subject" })
      `
      const messages = extract(code)
      expect(messages).toHaveLength(2)
      expect(messages[0].message).toBe("Hello")
      expect(messages[1].message).toBe("Hello {name}")
      expect(messages[1].context).toBe("email.subject")
    })

    it("extracts plural and select messages", () => {
      const code = `
        import { plural, select } from "@palamedes/core/macro"
        const one = plural(count, { one: "# item", other: "# items" })
        const two = select(gender, { male: "He", female: "She", other: "They" })
      `
      const messages = extract(code)
      expect(messages).toHaveLength(2)
      expect(messages[0].message).toBe("{count, plural, one {# item} other {# items}}")
      expect(messages[1].message).toBe("{gender, select, male {He} female {She} other {They}}")
    })
  })

  describe("runtime calls", () => {
    it("extracts i18n._ string authoring as source message", () => {
      const code = `
        const x = i18n._("Hello World")
      `
      const messages = extract(code)
      expect(messages).toHaveLength(1)
      expect(messages[0].message).toBe("Hello World")
    })

    it("prefers descriptor message for transformed runtime output", () => {
      const code = `
        const x = i18n._("compiled-id", { name }, { message: "Hello {name}", context: "greeting" })
      `
      const messages = extract(code)
      expect(messages).toHaveLength(1)
      expect(messages[0].message).toBe("Hello {name}")
      expect(messages[0].context).toBe("greeting")
    })

    it("extracts i18n.t tagged templates as source messages", () => {
      const code = `
        const x = i18n.t\`Hello World\`
      `
      const messages = extract(code)
      expect(messages).toHaveLength(1)
      expect(messages[0].message).toBe("Hello World")
    })
  })

  describe("placeholder metadata", () => {
    it("keeps source expressions for template literal placeholder hints", () => {
      const code = `
        import { t } from "@palamedes/core/macro"
        const message = t\`Hello \${name}, \${resolved.locale}\`
      `
      const messages = extract(code)

      expect(messages).toHaveLength(1)
      expect(messages[0].message).toBe("Hello {name}, {locale}")
      expect(messages[0].placeholders).toEqual({
        name: "name",
        locale: "resolved.locale",
      })
    })
  })

  describe("breaking changes", () => {
    it("rejects explicit ids in macros", () => {
      const code = `
        import { t } from "@palamedes/core/macro"
        const x = t({ id: "greeting", message: "Hello" })
      `

      expect(() => extract(code)).toThrow(/Explicit message ids/)
    })

    it("rejects explicit ids in runtime descriptors", () => {
      const code = `
        const x = i18n._({ id: "greeting", message: "Hello" })
      `

      expect(() => extract(code)).toThrow(/Explicit message ids/)
    })

    it("rejects unnamed template placeholders", () => {
      const code = [
        `import { t } from "@palamedes/core/macro"`,
        "const x = t`Hello ${firstName + lastName}`",
      ].join("\n")

      expect(() => extract(code)).toThrow(/stable placeholder name/)
    })

    it("rejects unnamed JSX placeholders", () => {
      const code = `
        import { Trans } from "@palamedes/react/macro"
        const x = <Trans>Hello {firstName + lastName}</Trans>
      `

      expect(() => extract(code)).toThrow(/stable placeholder name/)
    })

    it("rejects unnamed choice value placeholders", () => {
      const code = `
        import { plural } from "@palamedes/core/macro"
        const x = plural(count + 1, { one: "# item", other: "# items" })
      `

      expect(() => extract(code)).toThrow(/stable placeholder name/)
    })
  })
})
