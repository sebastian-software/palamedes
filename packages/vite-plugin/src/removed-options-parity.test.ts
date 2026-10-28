import { loadPalamedesConfig, loadPalamedesConfigSync } from "@palamedes/config";
import { REMOVED_PALAMEDES_OPTION_MESSAGES } from "@palamedes/core-node";
import { describe, expect, it } from "vitest";

// `@palamedes/config` cannot depend on the native package, so it keeps its own
// copy of the shared `cwd` migration error. Both packages are dependencies of
// the Vite plugin, which makes this the place to keep the copies identical.
describe("removed option messages", () => {
  it("rejects the config loader cwd option with the shared migration error", async () => {
    const options = { cwd: process.cwd() } as unknown as Parameters<typeof loadPalamedesConfig>[0];

    expect(() => loadPalamedesConfigSync(options)).toThrow(REMOVED_PALAMEDES_OPTION_MESSAGES.cwd);
    await expect(loadPalamedesConfig(options)).rejects.toThrow(
      REMOVED_PALAMEDES_OPTION_MESSAGES.cwd,
    );
  });
});
