import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getI18n: vi.fn(),
  initializeApplication: vi.fn(),
  loadRegisteredMessages: vi.fn(),
}))

vi.mock("@palamedes/next-plugin/server-function-entry", () => ({
  initializeServerFunctionI18n: mocks.initializeApplication,
}))

vi.mock("@palamedes/runtime", () => ({
  getI18n: mocks.getI18n,
  loadRegisteredMessages: mocks.loadRegisteredMessages,
}))

import { initializeServerFunctionI18n } from "./server-function-initializer"

describe("Server Function initializer adapter", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.initializeApplication.mockResolvedValue(undefined)
    mocks.loadRegisteredMessages.mockResolvedValue(undefined)
  })

  it("loads the active locale's registered graph messages after app initialization", async () => {
    const i18n = { locale: "de", _: vi.fn(), load: vi.fn() }
    mocks.getI18n.mockReturnValue(i18n)

    await initializeServerFunctionI18n()

    expect(mocks.initializeApplication).toHaveBeenCalledOnce()
    expect(mocks.getI18n).toHaveBeenCalledOnce()
    expect(mocks.loadRegisteredMessages).toHaveBeenCalledWith(i18n, "de")
    expect(mocks.initializeApplication.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.loadRegisteredMessages.mock.invocationCallOrder[0]!
    )
  })
})
