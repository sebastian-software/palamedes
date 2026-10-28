import type { PalamedesFramework as TransformFramework } from "@palamedes/transform";
import { describe, expectTypeOf, it } from "vitest";

import type { PalamedesFramework, PalamedesPluginOptions } from "./index";

// The Stable plugin owns its option type, and forwards the value to the
// Preview transform package. Type checking fails when the two unions drift.
describe("PalamedesFramework", () => {
  it("matches the transform's framework union", () => {
    expectTypeOf<PalamedesFramework>().toEqualTypeOf<TransformFramework>();
    expectTypeOf<
      NonNullable<PalamedesPluginOptions["framework"]>
    >().toEqualTypeOf<PalamedesFramework>();
  });
});
