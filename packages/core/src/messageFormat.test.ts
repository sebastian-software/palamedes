import { describe, expect, it } from "vitest"

import { formatMessagePattern, parseMessagePattern } from "./messageFormat"

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
        options: {
          other: [
            { type: "text", value: "Line" },
            { type: "tag", name: "0", children: [] },
            { type: "text", value: "break" },
          ],
        },
      },
    ])
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
})
