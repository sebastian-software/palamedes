import { afterEach, describe, expect, it, vi } from "vitest"

import {
  SERVER_I18N_TEST_BARRIER_REACHED_HEADER,
  markServerI18nTestBarrierReached,
  waitForServerI18nTestBarrier,
} from "./server-test"

const TEST_BARRIER_HEADER = "x-palamedes-i18n-test-barrier"
const TEST_BARRIERS_KEY = Symbol.for("palamedes.runtime.serverI18nTestBarriers")

function barrierRequest(barrierId?: string): Request {
  return new Request("https://example.test/", {
    headers: barrierId ? { [TEST_BARRIER_HEADER]: barrierId } : {},
  })
}

function enableBarrier(): void {
  vi.stubEnv("PALAMEDES_I18N_TEST_BARRIER", "1")
}

/** Captures a rejection immediately, so the timer can fire unattended. */
function settle(pending: Promise<void> | undefined): Promise<unknown> {
  return Promise.resolve(pending).then(
    (value) => value,
    (error: unknown) => error
  )
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.useRealTimers()
  delete (globalThis as Record<symbol, unknown>)[TEST_BARRIERS_KEY]
})

describe("server i18n test barrier", () => {
  it("stays inert unless both the environment opt-in and the header are present", () => {
    // A production server must never be able to park a request here, so both
    // gates are checked independently.
    expect(waitForServerI18nTestBarrier(barrierRequest("only-header"))).toBeUndefined()

    enableBarrier()
    expect(waitForServerI18nTestBarrier(barrierRequest())).toBeUndefined()

    vi.stubEnv("PALAMEDES_I18N_TEST_BARRIER", "true")
    expect(waitForServerI18nTestBarrier(barrierRequest("wrong-opt-in"))).toBeUndefined()

    expect((globalThis as Record<symbol, unknown>)[TEST_BARRIERS_KEY]).toBeUndefined()
  })

  it("releases both requests only once the second one arrives", async () => {
    enableBarrier()

    let firstSettled = false
    const first = waitForServerI18nTestBarrier(barrierRequest("pair"))
    expect(first).toBeInstanceOf(Promise)
    void first?.then(() => {
      firstSettled = true
    })

    await Promise.resolve()
    expect(firstSettled).toBe(false)

    const second = waitForServerI18nTestBarrier(barrierRequest("pair"))
    await expect(second).resolves.toBeUndefined()
    await expect(first).resolves.toBeUndefined()
    expect(firstSettled).toBe(true)
  })

  it("rejects a request that never finds a partner", async () => {
    vi.useFakeTimers()
    enableBarrier()

    // The rejection is captured before the clock moves, so the timer can fire
    // without an unhandled rejection in between.
    const lonely = settle(waitForServerI18nTestBarrier(barrierRequest("lonely")))
    await vi.advanceTimersByTimeAsync(5e3)

    expect(await lonely).toMatchObject({
      message: expect.stringMatching(
        /Timed out waiting for a second server i18n test request in barrier "lonely"/u
      ),
    })
  })

  it("does not let a third request reuse a completed rendezvous", async () => {
    vi.useFakeTimers()
    enableBarrier()

    const first = waitForServerI18nTestBarrier(barrierRequest("triple"))
    const second = waitForServerI18nTestBarrier(barrierRequest("triple"))
    await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined])

    // The completed barrier is gone, so a late third request starts a fresh
    // rendezvous and fails loudly rather than passing through unsynchronised.
    const third = settle(waitForServerI18nTestBarrier(barrierRequest("triple")))
    await vi.advanceTimersByTimeAsync(5e3)

    expect(await third).toMatchObject({
      message: expect.stringMatching(/Timed out waiting for a second/u),
    })
  })

  it("keeps separate barrier ids independent", async () => {
    vi.useFakeTimers()
    enableBarrier()

    const alone = settle(waitForServerI18nTestBarrier(barrierRequest("alpha")))
    const firstBeta = waitForServerI18nTestBarrier(barrierRequest("beta"))
    const secondBeta = waitForServerI18nTestBarrier(barrierRequest("beta"))

    await expect(Promise.all([firstBeta, secondBeta])).resolves.toEqual([undefined, undefined])
    await vi.advanceTimersByTimeAsync(5e3)

    expect(await alone).toMatchObject({ message: expect.stringMatching(/barrier "alpha"/u) })
  })

  it("marks the response only for requests the barrier actually governs", () => {
    const headers = new Headers()

    markServerI18nTestBarrierReached(barrierRequest("marked"), headers)
    expect(headers.get(SERVER_I18N_TEST_BARRIER_REACHED_HEADER)).toBeNull()

    enableBarrier()
    markServerI18nTestBarrierReached(barrierRequest(), headers)
    expect(headers.get(SERVER_I18N_TEST_BARRIER_REACHED_HEADER)).toBeNull()

    // The verifier requires this marker, so an adapter that never registers its
    // barrier cannot report a false-positive isolation result.
    markServerI18nTestBarrierReached(barrierRequest("marked"), headers)
    expect(headers.get(SERVER_I18N_TEST_BARRIER_REACHED_HEADER)).toBe("marked")
  })
})
