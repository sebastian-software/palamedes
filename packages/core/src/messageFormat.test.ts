import { describe, expect, it } from "vitest"

import { formatMessagePattern, parseMessagePattern } from "./messageFormat"

describe("parseMessagePattern", () => {
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
  it("renders a self-closing placeholder as empty text", () => {
    expect(formatMessagePattern("Line one<0/>Line two")).toBe("Line oneLine two")
  })
})
