import { describe, expect, it } from "vitest"

import { displayBenchmarkTime } from "./bench"

describe("displayBenchmarkTime", () => {
  it("switches units after millisecond rounding at the one-second fencepost", () => {
    expect(displayBenchmarkTime(999.49)).toBe("999 ms")
    expect(displayBenchmarkTime(999.5)).toBe("1.0 s")
    expect(displayBenchmarkTime(999.99)).toBe("1.0 s")
    expect(displayBenchmarkTime(1000)).toBe("1.0 s")
  })

  it("rounds seconds directly from the measured median", () => {
    expect(displayBenchmarkTime(1049.5)).toBe("1.0 s")
    expect(displayBenchmarkTime(1050)).toBe("1.1 s")
  })
})
