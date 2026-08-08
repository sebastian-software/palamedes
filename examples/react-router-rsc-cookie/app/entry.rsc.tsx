import type { RouterContextProvider } from "react-router"
import defaultEntry from "@react-router/dev/config/default-rsc-entries/entry.rsc"
import { createReactRouterRscI18nRequestScope } from "@palamedes/react-router-rsc"
import {
  markServerI18nTestBarrierReached,
  waitForServerI18nTestBarrier,
} from "@palamedes/runtime/server/test"

import { createRequestI18n } from "./lib/i18n"

const palamedesI18n = createReactRouterRscI18nRequestScope(createRequestI18n)

export default {
  fetch(request: Request, requestContext?: RouterContextProvider) {
    return palamedesI18n.run(request, async () => {
      await waitForServerI18nTestBarrier(request)
      const response = await defaultEntry.fetch(request, requestContext)
      markServerI18nTestBarrierReached(request, response.headers)
      return response
    })
  },
}

if (import.meta.hot) {
  import.meta.hot.accept()
}
