import { describe, expect, it } from "vitest";

import { displayBenchmarkRange, displayBenchmarkTime } from "./bench";

describe("displayBenchmarkTime", () => {
  it("switches units after millisecond rounding at the one-second fencepost", () => {
    expect(displayBenchmarkTime(999.49)).toBe("999 ms");
    expect(displayBenchmarkTime(999.5)).toBe("1.0 s");
    expect(displayBenchmarkTime(999.99)).toBe("1.0 s");
    expect(displayBenchmarkTime(1000)).toBe("1.0 s");
  });

  it("rounds seconds directly from the measured median", () => {
    expect(displayBenchmarkTime(1049.5)).toBe("1.0 s");
    expect(displayBenchmarkTime(1050)).toBe("1.1 s");
  });
});

describe("displayBenchmarkRange", () => {
  it("shares units without mixing millisecond and second boundaries", () => {
    expect(displayBenchmarkRange(78.978, 110.497)).toBe("79–110 ms");
    expect(displayBenchmarkRange(2798.3, 2980.2)).toBe("2.8–3.0 s");
    expect(displayBenchmarkRange(999, 1000)).toBe("999 ms–1.0 s");
  });
});
