import { describe, expect, it, vi } from "vitest";
import { defineCompiledCatalog } from "@palamedes/core/compiled";
import { createDevelopmentCatalogUpdater } from "./developmentCatalog";

describe("development catalog generations", () => {
  it("ignores a failed obsolete import after a newer snapshot commits", async () => {
    let rejectOld!: (error: Error) => void;
    const old = new Promise<never>((_resolve, reject) => {
      rejectOld = reject;
    });
    const messages = defineCompiledCatalog({ label: "new" });
    const apply = vi.fn();
    const update = createDevelopmentCatalogUpdater(
      (generation) => (generation === 0 ? old : Promise.resolve({ generation: 1, messages })),
      apply,
    );
    const obsolete = update(0);
    await update(1);
    rejectOld(new Error("obsolete request failed"));
    await expect(obsolete).resolves.toBeUndefined();
    expect(apply).toHaveBeenCalledExactlyOnceWith(messages);
  });

  it("does not let a late older snapshot replace the committed generation", async () => {
    let releaseOld!: (snapshot: {
      generation: number;
      messages: ReturnType<typeof defineCompiledCatalog>;
    }) => void;
    const old = new Promise<{
      generation: number;
      messages: ReturnType<typeof defineCompiledCatalog>;
    }>((resolve) => {
      releaseOld = resolve;
    });
    const newer = defineCompiledCatalog({ label: "new" });
    const apply = vi.fn();
    const update = createDevelopmentCatalogUpdater(
      (generation) =>
        generation === 0 ? old : Promise.resolve({ generation: 1, messages: newer }),
      apply,
    );
    const pendingOld = update(0);
    await update(1);
    releaseOld({ generation: 0, messages: defineCompiledCatalog({ label: "old" }) });
    await pendingOld;
    await update(0);
    expect(apply).toHaveBeenCalledExactlyOnceWith(newer);
  });

  it("shares one complete snapshot across eager and lazy consumers", async () => {
    const messages = defineCompiledCatalog({ eager: "new eager", lazy: "new lazy" });
    const load = vi.fn(async () => ({ generation: 2, messages }));
    const apply = vi.fn();
    const update = createDevelopmentCatalogUpdater(load, apply);
    await Promise.all([update(2), update(2), update(1)]);
    expect(load).toHaveBeenCalledOnce();
    expect(apply).toHaveBeenCalledExactlyOnceWith(messages);
  });

  it("keeps the last committed snapshot when an edit fails and retries a corrected edit", async () => {
    const first = defineCompiledCatalog({ label: "first" });
    const corrected = defineCompiledCatalog({ label: "corrected" });
    const load = vi
      .fn()
      .mockResolvedValueOnce({ generation: 0, messages: first })
      .mockRejectedValueOnce(new Error("invalid catalog"))
      .mockResolvedValueOnce({ generation: 1, messages: corrected });
    const apply = vi.fn();
    const update = createDevelopmentCatalogUpdater(load, apply);
    await update(0);
    await expect(update(1)).rejects.toThrow("invalid catalog");
    expect(apply).toHaveBeenCalledExactlyOnceWith(first);
    await update(1);
    expect(apply.mock.calls.map(([messages]) => messages)).toEqual([first, corrected]);
  });
});
