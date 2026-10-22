import { defineEventHandler, getRequestHeader, getRequestURL, sendRedirect } from "h3";
import { createDemoLocalePolicy } from "@palamedes/example-ui";

export default defineEventHandler((event) => {
  const url = getRequestURL(event);
  if (url.pathname !== "/" && url.pathname !== "/insights") return;
  const policy = createDemoLocalePolicy(
    url,
    getRequestHeader(event, "cookie"),
    getRequestHeader(event, "accept-language"),
    process.env.PALAMEDES_DEMO_STRATEGY,
  );
  if (policy.redirect)
    return sendRedirect(event, new URL(policy.redirect).pathname + url.search, 302);
});
