import { waitForServerI18nTestBarrier } from "@palamedes/runtime/server/test"
import { unstable_getRequest, type HandlerInterceptor } from "waku/router/server"

// fsRouter registers interceptor files in lexical order. This filename follows
// palamedes.server.ts, so reduceRight runs this barrier inside the Palamedes
// request scope after i18n activation and before page rendering begins.
const testBarrierInterceptor: HandlerInterceptor = async (next) => {
  await waitForServerI18nTestBarrier(unstable_getRequest())
  return await next()
}

export default testBarrierInterceptor
