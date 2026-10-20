import express from "express";
import { t } from "@palamedes/core/macro";
import { getBooking } from "./booking.ts";
import { requestI18n, requestScope } from "./http-context.ts";

const app = express();
app.disable("x-powered-by");
app.use(async (req, res, next) => {
  const i18n = await requestI18n(req.header("accept-language"));
  res.set("Content-Language", i18n.locale);
  res.vary("Accept-Language");
  res.set("Cache-Control", "private, no-store");
  requestScope.run(i18n, next);
});
app.get("/bookings/:id", async (req, res) => {
  const booking = await getBooking(req.params.id);
  res.status("id" in booking ? 200 : 404).json({ label: t`Booking details.`, ...booking });
});
app.use(((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ code: "INTERNAL_ERROR" });
}) satisfies express.ErrorRequestHandler);

const server = app.listen(Number(process.env.PORT ?? 3000), "127.0.0.1", () => {
  const address = server.address();
  if (address && typeof address !== "string") console.log(JSON.stringify({ port: address.port }));
});
process.on("SIGTERM", () => {
  server.close();
  server.closeAllConnections();
});
