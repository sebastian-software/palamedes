import { describe, expect, it } from "vitest"

import { PACKAGE_BOUNDARY_STEP, QUICKSTART_STEPS, STACKS } from "./steps"

describe("quickstart step hierarchy", () => {
  it.each(STACKS)(
    "puts the package boundary directly after the $label install command",
    (stack) => {
      const steps = QUICKSTART_STEPS[stack.id]

      expect(steps[0]).toMatchObject({ title: "Install" })
      expect(steps[0]).toHaveProperty("code")
      expect(steps[1]).toBe(PACKAGE_BOUNDARY_STEP)
      expect(steps[2]).toMatchObject({ title: "Configure" })
      expect(steps).toHaveLength(7)
    }
  )
})
