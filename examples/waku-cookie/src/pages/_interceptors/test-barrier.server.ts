import { waitForServerI18nTestBarrier } from "@palamedes/runtime/server/test"
import { unstable_getRequest, type HandlerInterceptor } from "waku/router/server"

// fsRouter registers interceptor files in lexical order. This filename follows
// palamedes.server.ts, so reduceRight runs this barrier inside the Palamedes
// request scope after i18n activation and before page rendering begins.
const testBarrierInterceptor: HandlerInterceptor = async (next) => {
  let request: Request
  try {
    request = unstable_getRequest()
  } catch (error) {
    if (error instanceof Error && error.message === "Request is not available.") {
      return await next()
    }
    throw error
  }
  await waitForServerI18nTestBarrier(request)
  return await next()
}

export default testBarrierInterceptor
