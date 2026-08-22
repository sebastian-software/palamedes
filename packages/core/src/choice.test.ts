import { beforeEach, describe, expect, it, vi } from "vitest"

import { buildChoiceMessage } from "./choice"
import * as messageFormat from "./messageFormat"

vi.mock("./messageFormat", async (importOriginal) => {
  const original = await importOriginal<typeof messageFormat>()
  return {
    ...original,
    parseMessagePattern: vi.fn(original.parseMessagePattern),
  }
})

describe("buildChoiceMessage", () => {
  beforeEach(() => {
    vi.mocked(messageFormat.parseMessagePattern).mockClear()
  })

  it("normalizes exact plural choices into valid ICU branches", () => {
    expect(
      buildChoiceMessage("count", "plural", {
        _0: "No items",
        one: "One item",
        other: "# items",
      })
    ).toBe("{count, plural, =0 {No items} one {One item} other {# items}}")
  })

  it("rejects invalid plural options and offsets", () => {
    expect(() => buildChoiceMessage("count", "plural", { invalid: "Items", other: "#" })).toThrow(
      'Invalid plural option "invalid"'
    )
    expect(() => buildChoiceMessage("count", "plural", { other: "#" }, -1)).toThrow(
      "Plural offset must be a non-negative safe integer."
    )
  })

  it("rejects option text that cannot form an intact ICU pattern", () => {
    expect(() => buildChoiceMessage("kind", "select", { other: "broken }" })).toThrow(
      "produced an invalid ICU pattern"
    )
  })

  it("reuses validated choice messages with the same ordered options", () => {
    const choices = { one: "One item", other: "# items" }

    expect(buildChoiceMessage("count", "plural", choices)).toBe(
      "{count, plural, one {One item} other {# items}}"
    )
    expect(buildChoiceMessage("count", "plural", { ...choices })).toBe(
      "{count, plural, one {One item} other {# items}}"
    )
    expect(messageFormat.parseMessagePattern).toHaveBeenCalledTimes(1)

    expect(buildChoiceMessage("count", "plural", { ...choices, other: "Many items" })).toBe(
      "{count, plural, one {One item} other {Many items}}"
    )
    expect(messageFormat.parseMessagePattern).toHaveBeenCalledTimes(2)
  })

  it("bounds the validated choice message cache", () => {
    for (let index = 0; index < 300; index += 1) {
      buildChoiceMessage("cacheCount", "plural", {
        one: `One cached item ${index}`,
        other: `Cached items ${index}`,
      })
    }
    expect(messageFormat.parseMessagePattern).toHaveBeenCalledTimes(300)

    buildChoiceMessage("cacheCount", "plural", {
      one: "One cached item 0",
      other: "Cached items 0",
    })
    expect(messageFormat.parseMessagePattern).toHaveBeenCalledTimes(301)
  })
})
