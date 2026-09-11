import { createStartHandler, defaultStreamHandler } from "@tanstack/react-start/server";
import {
  markServerI18nTestBarrierReached,
  waitForServerI18nTestBarrier,
} from "@palamedes/runtime/server/test";

const handler = createStartHandler(defaultStreamHandler);

export default {
  async fetch(request: Request, options?: never) {
    await waitForServerI18nTestBarrier(request);
    const response = await handler(request, options);
    markServerI18nTestBarrierReached(request, response.headers);
    return response;
  },
};
