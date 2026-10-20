import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { t } from "@palamedes/core/macro";
import { getBooking } from "./booking.ts";
import { requestI18n, requestScope } from "./http-context.ts";

const app = new Hono();
app.use(async (c, next) => {
  const i18n = await requestI18n(c.req.header("accept-language"));
  c.header("Content-Language", i18n.locale);
  c.header("Vary", "Accept-Language");
  c.header("Cache-Control", "private, no-store");
  await requestScope.run(i18n, next);
});
app.get("/bookings/:id", async (c) => {
  const booking = await getBooking(c.req.param("id"));
  return c.json({ label: t`Booking details.`, ...booking }, "id" in booking ? 200 : 404);
});
app.onError((error, c) => {
  console.error(error);
  return c.json({ code: "INTERNAL_ERROR" }, 500);
});

const server = serve(
  { fetch: app.fetch, port: Number(process.env.PORT ?? 3000), hostname: "127.0.0.1" },
  (address) => console.log(JSON.stringify({ port: address.port })),
);
process.on("SIGTERM", () => {
  server.close();
  if ("closeAllConnections" in server) server.closeAllConnections();
});
