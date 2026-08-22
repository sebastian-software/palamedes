import { readFileSync } from "node:fs"

import { afterEach, describe, expect, it, vi } from "vitest"

import * as serverTest from "./server-test"
import {
  SERVER_I18N_TEST_BARRIER_REACHED_HEADER,
  markServerI18nTestBarrierReached,
  waitForServerI18nTestBarrier,
} from "./server-test"
import * as serverTestUnavailable from "./server-test-unavailable"

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

describe("@palamedes/runtime/server/test fallback", () => {
  it("mirrors every export, so non-Node resolution fails with the curated message", () => {
    // A missing binding here would fail at module link time instead, which
    // hides why the subpath is unavailable.
    expect(Object.keys(serverTestUnavailable).sort()).toStrictEqual(Object.keys(serverTest).sort())
    expect(serverTestUnavailable.SERVER_I18N_TEST_BARRIER_REACHED_HEADER).toBe(
      SERVER_I18N_TEST_BARRIER_REACHED_HEADER
    )
    expect(() =>
      serverTestUnavailable.waitForServerI18nTestBarrier(barrierRequest("fallback"))
    ).toThrow(/only available in Node\.js server runtimes/)
    expect(() =>
      serverTestUnavailable.markServerI18nTestBarrierReached(
        barrierRequest("fallback"),
        new Headers()
      )
    ).toThrow(/only available in Node\.js server runtimes/)
  })

  it("maps the non-Node conditions of ./server/test to that fallback", () => {
    const packageJson = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8")
    ) as {
      exports: Record<string, { browser: unknown; default: unknown }>
    }
    const fallback = {
      import: {
        types: "./dist/server-test-unavailable.d.mts",
        default: "./dist/server-test-unavailable.mjs",
      },
      require: {
        types: "./dist/server-test-unavailable.d.cts",
        default: "./dist/server-test-unavailable.cjs",
      },
    }

    expect(packageJson.exports["./server/test"]?.browser).toStrictEqual(fallback)
    expect(packageJson.exports["./server/test"]?.default).toStrictEqual(fallback)
  })
})
