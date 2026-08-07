import { createIsomorphicFn, createStart } from "@tanstack/react-start"
import { createTanStackI18nRequestMiddleware } from "@palamedes/tanstack"

// `src/start.ts` is also part of the client graph. Start removes this server
// branch, keeping catalog initialization and AsyncLocalStorage out of the client.
const tanStackI18nMiddleware = createIsomorphicFn().server(() =>
  createTanStackI18nRequestMiddleware(async (request) => {
    const { createServerI18nFromRequest } = await import("./lib/i18n.server")
    return await createServerI18nFromRequest(request)
  })
)()

export const startInstance = createStart(() => ({
  requestMiddleware: [tanStackI18nMiddleware],
}))
