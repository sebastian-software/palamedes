/**
 * Non-Node fallback for `@palamedes/runtime/server/test`. It must mirror every
 * export of `server-test.ts`, otherwise a bundler fails at module link time
 * with a missing-binding error instead of the curated message below.
 */
const SERVER_TEST_RUNTIME_UNAVAILABLE_MESSAGE =
  "@palamedes/runtime/server/test is only available in Node.js server runtimes. Import it from the Node test runner, not from Client Components or Edge runtime code."

// Duplicated from server-test.ts rather than imported, so this fallback stays
// free of the Node-only barrier implementation. server-test.test.ts pins the
// two literals together.
export const SERVER_I18N_TEST_BARRIER_REACHED_HEADER = "x-palamedes-i18n-test-barrier-reached"

export function markServerI18nTestBarrierReached(_request: Request, _headers: Headers): void {
  throw new Error(SERVER_TEST_RUNTIME_UNAVAILABLE_MESSAGE)
}

export function waitForServerI18nTestBarrier(_request: Request): Promise<void> | undefined {
  throw new Error(SERVER_TEST_RUNTIME_UNAVAILABLE_MESSAGE)
}
