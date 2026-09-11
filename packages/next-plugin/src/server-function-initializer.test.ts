import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getI18n: vi.fn(),
  initializeApplication: vi.fn(),
}));

vi.mock("@palamedes/next-plugin/server-function-entry", () => ({
  initializeServerFunctionI18n: mocks.initializeApplication,
}));

vi.mock("@palamedes/runtime", () => ({
  getI18n: mocks.getI18n,
}));

import { initializeServerFunctionI18n } from "./server-function-initializer";

describe("Server Function initializer adapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.initializeApplication.mockResolvedValue(undefined);
  });

  it("requires an active request after application initialization", async () => {
    const i18n = { locale: "de", _: vi.fn(), load: vi.fn() };
    mocks.getI18n.mockReturnValue(i18n);

    await initializeServerFunctionI18n();

    expect(mocks.initializeApplication).toHaveBeenCalledOnce();
    expect(mocks.getI18n).toHaveBeenCalledOnce();
    expect(mocks.initializeApplication.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.getI18n.mock.invocationCallOrder[0]!,
    );
  });
});
