import { describe, expect, it } from "vitest"

import {
  formatMessagePattern,
  parseMessagePattern,
  resolveChoice,
  type MessageNode,
} from "./messageFormat"

// Parsed choice options carry a null prototype so message-supplied keys can
// never reach Object.prototype members; expectations must match that shape for
// toStrictEqual, which compares constructors.
function choiceOptions(options: Record<string, MessageNode[]>): Record<string, MessageNode[]> {
  return Object.assign(Object.create(null) as Record<string, MessageNode[]>, options)
}

describe("parseMessagePattern", () => {
  it("keeps quoted ICU syntax in literal nodes", () => {
    expect(parseMessagePattern("Literal '{name}' here")).toStrictEqual([
      { type: "text", value: "Literal " },
      { type: "literal", value: "{name}" },
      { type: "text", value: " here" },
    ])
  })

  it("parses a self-closing placeholder as a tag with no children", () => {
    expect(parseMessagePattern("Line one<0/>Line two")).toStrictEqual([
      { type: "text", value: "Line one" },
      { type: "tag", name: "0", children: [] },
      { type: "text", value: "Line two" },
    ])
  })

  it("still parses paired tags with children", () => {
    expect(parseMessagePattern("Powered by <0>Palamedes</0>")).toStrictEqual([
      { type: "text", value: "Powered by " },
      { type: "tag", name: "0", children: [{ type: "text", value: "Palamedes" }] },
    ])
  })

  it("parses a self-closing placeholder inside plural options", () => {
    expect(parseMessagePattern("{count, plural, other {Line<0/>break}}")).toStrictEqual([
      {
        type: "choice",
        variable: "count",
        kind: "plural",
        options: choiceOptions({
          other: [
            { type: "text", value: "Line" },
            { type: "tag", name: "0", children: [] },
            { type: "text", value: "break" },
          ],
        }),
      },
    ])
  })

  it("parses plural offsets separately from choice keys", () => {
    expect(
      parseMessagePattern(
        "{count, plural, offset:1 one {you and one other} other {you and # others}}"
      )
    ).toStrictEqual([
      {
        type: "choice",
        variable: "count",
        kind: "plural",
        offset: 1,
        options: choiceOptions({
          one: [{ type: "text", value: "you and one other" }],
          other: [{ type: "text", value: "you and # others" }],
        }),
      },
    ])
  })

  it("builds choice options without a prototype chain", () => {
    const [node] = parseMessagePattern("{n, select, other {O}}")

    expect(node?.type).toBe("choice")
    expect(Object.getPrototypeOf((node as { options: object }).options)).toBeNull()
  })

  it("keeps hot patterns cached past the formatter cache limit", () => {
    const hot = "hot pattern {value}"
    const nodes = parseMessagePattern(hot)

    for (let index = 0; index < 200; index += 1) {
      parseMessagePattern(`filler ${index} {value}`)
    }

    // A 64-entry bound shared with the Intl caches evicted this immediately.
    expect(parseMessagePattern(hot)).toBe(nodes)
  })

  it("refreshes cached patterns on hit so hot entries survive eviction", () => {
    const hot = "recently used pattern {value}"
    const nodes = parseMessagePattern(hot)

    for (let index = 0; index < 1200; index += 1) {
      parseMessagePattern(`lru filler ${index} {value}`)
      if (index % 100 === 0) {
        parseMessagePattern(hot)
      }
    }

    expect(parseMessagePattern(hot)).toBe(nodes)
  })
})

describe("formatMessagePattern", () => {
  it("supports ICU apostrophe quoting without changing natural apostrophes", () => {
    expect(formatMessagePattern("It's done")).toBe("It's done")
    expect(formatMessagePattern("It''s done")).toBe("It's done")
    expect(formatMessagePattern("This '{isn''t}' obvious")).toBe("This {isn't} obvious")
  })

  it("auto-closes an unterminated quoted sequence at the end of the pattern", () => {
    expect(
      formatMessagePattern("Send '{name} to {target}", {
        name: "Alice",
        target: "Bob",
      })
    ).toBe("Send {name} to {target}")
  })

  it("keeps quoted arguments and plural pound signs literal", () => {
    expect(formatMessagePattern("Literal '{name}' here", { name: "value" })).toBe(
      "Literal {name} here"
    )
    expect(formatMessagePattern("{n, plural, other {'#' of #}}", { n: 5 }, "en")).toBe("# of 5")
  })

  it("makes literal braces representable", () => {
    expect(formatMessagePattern("Use '{' to open and '}' to close")).toBe(
      "Use { to open and } to close"
    )
  })

  it("renders a self-closing placeholder as empty text", () => {
    expect(formatMessagePattern("Line one<0/>Line two")).toBe("Line oneLine two")
  })

  it("applies plural offsets to category selection and pound replacement", () => {
    const message =
      "{n, plural, offset:1 =0 {nobody} =3 {exactly #} one {you and one other} other {you and # others}}"

    expect(formatMessagePattern(message, { n: 0 }, "en")).toBe("nobody")
    expect(formatMessagePattern(message, { n: 2 }, "en")).toBe("you and one other")
    expect(formatMessagePattern(message, { n: 3 }, "en")).toBe("exactly 2")
    expect(formatMessagePattern(message, { n: 4 }, "en")).toBe("you and 3 others")
  })

  it("rejects malformed plural offsets", () => {
    expect(() =>
      formatMessagePattern("{n, plural, offset:-1 other {# items}}", { n: 2 }, "en")
    ).toThrow(/non-negative integer plural offset/)
    expect(() =>
      formatMessagePattern("{n, plural, offset:1.5 other {# items}}", { n: 2 }, "en")
    ).toThrow(/non-negative integer plural offset/)
  })

  it("rejects absent or non-numeric plural values instead of coercing to 0", () => {
    const message = "{n, plural, =0 {none} one {one} other {# items}}"

    expect(() => formatMessagePattern(message, {}, "en")).toThrow(/Missing or non-numeric value/)
    expect(() => formatMessagePattern(message, { n: undefined }, "en")).toThrow(
      /received undefined/
    )
    expect(() => formatMessagePattern(message, { n: Number.NaN }, "en")).toThrow(/received NaN/)
    expect(() =>
      formatMessagePattern("{n, selectordinal, other {#th}}", { n: "abc" }, "en")
    ).toThrow(/received "abc"/)
  })

  it("still accepts numeric strings for plural values", () => {
    const message = "{n, plural, =0 {none} other {# items}}"

    expect(formatMessagePattern(message, { n: "0" }, "en")).toBe("none")
    expect(formatMessagePattern(message, { n: "4" }, "en")).toBe("4 items")
  })

  it("never resolves select values to Object.prototype members", () => {
    const message = "{n, select, toString {C} other {O}}"

    expect(formatMessagePattern(message, { n: "valueOf" })).toBe("O")
    expect(formatMessagePattern(message, { n: "hasOwnProperty" })).toBe("O")
    expect(formatMessagePattern(message, { n: "constructor" })).toBe("O")
    expect(formatMessagePattern(message, { n: "toString" })).toBe("C")
    expect(formatMessagePattern("{n, select, other {O}}", { n: "__proto__" })).toBe("O")
  })

  it("ignores inherited option keys on externally built choice nodes", () => {
    // Nodes can arrive from outside the parser (hand-written, deserialized), so
    // the lookup itself must be own-property only.
    const resolved = resolveChoice(
      {
        type: "choice",
        variable: "n",
        kind: "select",
        options: { other: [{ type: "text", value: "O" }] },
      },
      "toString"
    )

    expect(resolved.nodes).toStrictEqual([{ type: "text", value: "O" }])
  })

  it("renders Date values as ISO strings and degrades invalid Dates", () => {
    const when = new Date(Date.UTC(2026, 6, 24, 2, 0, 0))

    expect(formatMessagePattern("At {when}", { when })).toBe(`At ${when.toISOString()}`)
    expect(formatMessagePattern("At {when}", { when: new Date("garbage") })).toBe("At Invalid Date")
  })

  it("preserves date-only ISO strings as civil dates across configured time zones", () => {
    const dateOnly = "2026-06-12"
    const expected = `Due ${new Intl.DateTimeFormat("en-US", {
      dateStyle: "medium",
      timeZone: "UTC",
    }).format(new Date(dateOnly))}`

    for (const timeZone of ["UTC", "America/Los_Angeles", "Asia/Tokyo"]) {
      expect(
        formatMessagePattern("Due {when, date, medium}", { when: dateOnly }, "en-US", timeZone)
      ).toBe(expected)
    }
  })
})
