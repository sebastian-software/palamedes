import { describe, expect, it } from "vitest"

import { buildChoiceMessage } from "./choice"

describe("buildChoiceMessage", () => {
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
})
