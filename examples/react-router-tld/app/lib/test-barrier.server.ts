import type { MiddlewareFunction } from "react-router";
import {
  markServerI18nTestBarrierReached,
  waitForServerI18nTestBarrier,
} from "@palamedes/runtime/server/test";

/**
 * Test-only rendezvous for the repository's concurrency checks. It runs after
 * the i18n middleware, so two overlapping requests meet inside their scopes.
 * It does nothing unless PALAMEDES_I18N_TEST_BARRIER=1 is set and the request
 * carries the test header; applications do not need it.
 */
export const serverI18nTestBarrier: MiddlewareFunction<Response> = async ({ request }, next) => {
  await waitForServerI18nTestBarrier(request);
  const response = await next();
  markServerI18nTestBarrierReached(request, response.headers);
  return response;
};
