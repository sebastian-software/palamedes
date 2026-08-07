/**
 * Test-only request rendezvous for proving server i18n isolation. It is inert
 * unless the test runner explicitly enables it and sends the matching header.
 */
const TEST_BARRIER_ENV = "PALAMEDES_I18N_TEST_BARRIER"
const TEST_BARRIER_HEADER = "x-palamedes-i18n-test-barrier"
const TEST_BARRIER_TIMEOUT_MS = 5e3
const TEST_BARRIERS_KEY = Symbol.for("palamedes.runtime.serverI18nTestBarriers")

type Barrier = {
  arrivals: number
  reject(error: Error): void
  resolve(): void
  timeout: ReturnType<typeof setTimeout>
}

type TestBarrierState = typeof globalThis & {
  [TEST_BARRIERS_KEY]?: Map<string, Barrier>
}

function testBarriers(): Map<string, Barrier> {
  const state = globalThis as TestBarrierState
  const existing = state[TEST_BARRIERS_KEY]
  if (existing) return existing

  const barriers = new Map<string, Barrier>()
  state[TEST_BARRIERS_KEY] = barriers
  return barriers
}

/**
 * Wait for a matching request after its i18n scope has been activated and
 * before the framework begins rendering translations. This is deliberately
 * unreachable in normal servers: both the opt-in environment variable and a
 * per-request header are required.
 */
export function waitForServerI18nTestBarrier(request: Request): Promise<void> | undefined {
  if (process.env[TEST_BARRIER_ENV] !== "1") return

  const barrierId = request.headers.get(TEST_BARRIER_HEADER)
  if (!barrierId) return

  const barriers = testBarriers()
  const existing = barriers.get(barrierId)
  if (existing) {
    existing.arrivals += 1
    if (existing.arrivals === 2) {
      clearTimeout(existing.timeout)
      barriers.delete(barrierId)
      existing.resolve()
    }
    return new Promise((resolve) => queueMicrotask(resolve))
  }

  return new Promise((resolve, reject) => {
    const barrier: Barrier = {
      arrivals: 1,
      reject,
      resolve,
      timeout: setTimeout(() => {
        if (barriers.get(barrierId) !== barrier) return
        barriers.delete(barrierId)
        reject(
          new Error(
            `Timed out waiting for a second server i18n test request in barrier ${JSON.stringify(barrierId)}`
          )
        )
      }, TEST_BARRIER_TIMEOUT_MS),
    }
    barriers.set(barrierId, barrier)
  })
}
