import { createIsomorphicFn, createStart } from "@tanstack/react-start";
import { createTanStackServerI18nRequestMiddleware } from "@palamedes/tanstack";

// `src/start.ts` is also part of the client graph. Start removes this server
// branch, keeping catalog initialization and AsyncLocalStorage out of the client.
const tanStackI18nMiddleware = createIsomorphicFn().server(() =>
  createTanStackServerI18nRequestMiddleware(
    async (request) => {
      const { resolveLocaleFromRequest } = await import("./lib/i18n.server");
      return await resolveLocaleFromRequest(request);
    },
    undefined,
    process.env.PALAMEDES_CSP_NONCE
      ? { catalogDelivery: { nonce: process.env.PALAMEDES_CSP_NONCE } }
      : undefined,
  ),
)()!;

export const startInstance = createStart(() => ({
  requestMiddleware: [tanStackI18nMiddleware],
}));
