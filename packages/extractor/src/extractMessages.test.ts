import { extractMessages, extractor, type ExtractedMessageInfo } from "./index"

function extract(code: string) {
  return extractMessages(code, "test.tsx")
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
      expect(messages[0].message).toBe("Hello <0>World</0>")
    })

    it("deduplicates same-tag component placeholders with different props", () => {
      const code = `
        import { Trans } from "@palamedes/react/macro"
        const x = <Trans>Accept <a href="/terms">terms</a> and <a href="/privacy">privacy</a></Trans>
      `
      const messages = extract(code)
      expect(messages).toHaveLength(1)
      expect(messages[0].message).toBe("Accept <0>terms</0> and <1>privacy</1>")
    })

    it("uses Lingui-compatible self-closing placeholders for empty rich-text children", () => {
      const code = `
        import { Trans } from "@palamedes/react/macro"
        const x = <Trans>I agree to the <a href={COMMERCIAL_TERMS_URL}>Commercial Terms <ExternalLink className="inline" /></a></Trans>
      `
      const messages = extract(code)
      expect(messages).toHaveLength(1)
      expect(messages[0].message).toBe("I agree to the <0>Commercial Terms<1/></0>")
    })

    it("preserves inline whitespace before self-closing placeholders with trailing text", () => {
      const code = `
        import { Trans } from "@palamedes/react/macro"
        const x = <Trans>Foo <Icon /> bar</Trans>
      `
      const messages = extract(code)

      expect(messages).toHaveLength(1)
      expect(messages[0].message).toBe("Foo <0/> bar")
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

    it("decodes JSX entities before deriving extracted messages", () => {
      const code = `
        import { Trans } from "@palamedes/react/macro"
        const a = <Trans>Green-e&reg; applies to US &amp; Canada only</Trans>
        const b = <Trans message="Decision &quot;Model&quot; &#x26; review" />
        const c = <Trans>{"A &amp; B"}</Trans>
        const d = <Trans message={"Literal &amp; Value"} />
      `
      const messages = extract(code)
      expect(messages).toHaveLength(4)
      expect(messages[0].message).toBe("Green-e® applies to US & Canada only")
      expect(messages[1].message).toBe('Decision "Model" & review')
      expect(messages[2].message).toBe("A &amp; B")
      expect(messages[3].message).toBe("Literal &amp; Value")
    })

    it("normalizes rich-text placeholder boundary whitespace", () => {
      const code = `
        import { Trans } from "@palamedes/react/macro"
        const helper = <Trans>Reach out to your {" "}<a href="/advisor">advisor</a>{" "} for help.</Trans>
        const target = <Trans><strong>100%</strong> Clean Energy by {" "}<strong>{targetYear}</strong></Trans>
        const details = <Trans><strong>Dates & Capacity:</strong> {" "}commercial_operation_date, project_capacity_mw, buyer_capacity_mw</Trans>
        const confirm = <Trans>Delete {" "}<strong>{selectedProjectName}</strong> ? This action cannot be undone.</Trans>
        const tailored = <Trans>
          Tailored to your {volume} MWh of annual electricity use in {countryName}
          .
        </Trans>
        const literalBraces = <Trans>{"{name}"} .</Trans>
      `
      const messages = extract(code)

      expect(messages.map((message) => message.message)).toStrictEqual([
        "Reach out to your <0>advisor</0> for help.",
        "<0>100%</0> Clean Energy by <1>{targetYear}</1>",
        "<0>Dates & Capacity:</0> commercial_operation_date, project_capacity_mw, buyer_capacity_mw",
        "Delete <0>{selectedProjectName}</0>? This action cannot be undone.",
        "Tailored to your {volume} MWh of annual electricity use in {countryName}.",
        "{name} .",
      ])
    })

    it("preserves leading separator spacing", () => {
      const code = `
        import { Trans } from "@palamedes/react/macro"
        const price = <Trans> · \${priceFormatted}/MWh</Trans>
        const manager = <Trans> — no manager</Trans>
      `
      const messages = extract(code)

      expect(messages.map((message) => message.message)).toStrictEqual([
        " · ${priceFormatted}/MWh",
        " — no manager",
      ])
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
      expect(messages[0].placeholders).toStrictEqual({
        name: "name",
        locale: "resolved.locale",
      })
    })
  })

  describe("source extractor", () => {
    it("extracts directly from source without a caller-provided AST", async () => {
      const code = `
        import { t } from "@palamedes/core/macro"
        const message = t\`Hello \${name}\`
      `
      const messages: ExtractedMessageInfo[] = []

      await extractor.extract("test.ts", code, (message) => {
        messages.push(message)
      })

      expect(messages).toHaveLength(1)
      expect(messages[0].message).toBe("Hello {name}")
      expect(messages[0].placeholders).toStrictEqual({
        name: "name",
      })
      expect(messages[0].origin[0]).toBe("test.ts")
    })

    it("does not hide fatal native extraction errors", async () => {
      const code = `
        import { t } from "@palamedes/core/macro"
        const message = t({ id: "greeting", message: "Hello" })
      `

      await expect(extractor.extract("test.ts", code, () => {})).rejects.toThrow(
        /Explicit message ids/
      )
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

    it("rejects nested JSX message macros", () => {
      const code = `
        import { Plural, Trans } from "@palamedes/react/macro"
        const x = <Trans><Plural value={contractCount} one="# contract" other="# contracts" /> ({capacityMW} MW)</Trans>
      `

      expect(() => extract(code)).toThrow(
        /Nested i18n macro is not extractable as a single message at test\.tsx:3:\d+/
      )
    })

    it("rejects nested JSX message macros in expression containers", () => {
      const cases = [
        `<Trans>{showCount ? <Plural value={count} one="one" other="other" /> : null}</Trans>`,
        `<Trans>{showCount && <Plural value={count} one="one" other="other" />}</Trans>`,
        `<Trans>{items.map((item) => <Plural value={item.count} one="one" other="other" />)}</Trans>`,
      ]

      for (const jsx of cases) {
        const code = `
          import { Plural, Trans } from "@palamedes/react/macro"
          const x = ${jsx}
        `

        expect(() => extract(code)).toThrow(
          /Nested i18n macro is not extractable as a single message/
        )
        expect(() => extract(code)).not.toThrow(/stable placeholder name/)
      }
    })

    it("allows nested JSX message macros in render prop attributes", () => {
      const code = `
        import { Plural, Trans } from "@palamedes/react/macro"
        const x = <Trans><List renderItem={() => <Plural value={count} one="one" other="other" />} /></Trans>
      `

      const messages = extract(code)

      expect(messages[0].message).toBe("<0/>")
    })

    it("accepts computed, defaulted, and literal choice values", () => {
      const code = `
        import { plural } from "@palamedes/core/macro"
        import { Plural } from "@palamedes/react/macro"
        const computed = plural(periodCounts[period] ?? 0, { one: "# entry", other: "# entries" })
        const literal = plural(21, { one: "# month", other: "# months" })
        const jsx = <Plural value={node.locationCount ?? 0} one="# location" other="# locations" />
      `
      const messages = extract(code)

      expect(messages.map((message) => message.message)).toEqual([
        "{period, plural, one {# entry} other {# entries}}",
        "{value, plural, one {# month} other {# months}}",
        "{locationCount, plural, one {# location} other {# locations}}",
      ])
    })
  })
})
