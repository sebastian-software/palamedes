import { createServer } from "node:http";
import { defineLocaleControls } from "@palamedes/core/locale";
import { t } from "@palamedes/core/macro";
import { createServerI18nScope } from "@palamedes/runtime/server";
import { getBooking } from "./booking.ts";
import { createNodeI18n, defaultLocale, locales } from "./i18n.ts";

const scope = createServerI18nScope();
const controls = defineLocaleControls({ locales, defaultLocale });

const server = createServer(async (request, response) => {
  try {
    const i18n = await createNodeI18n({
      locale: controls.preferredLocale(request.headers["accept-language"]),
      timeZone: "UTC",
    });
    const id = new URL(request.url ?? "/", "http://localhost").pathname.split("/").at(-1) ?? "";
    const body = await scope.run(i18n, async () => {
      const booking = await getBooking(id);
      return { label: t`Booking details.`, ...booking };
    });
    response.writeHead("id" in body ? 200 : 404, {
      "Content-Type": "application/json",
      "Content-Language": i18n.locale,
      Vary: "Accept-Language",
    });
    response.end(JSON.stringify(body));
  } catch (error) {
    console.error(error);
    response.writeHead(500, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ code: "INTERNAL_ERROR" }));
  }
});

server.listen(Number(process.env.PORT ?? 3000), "127.0.0.1", () => {
  const address = server.address();
  if (address && typeof address !== "string") console.log(JSON.stringify({ port: address.port }));
});
process.on("SIGTERM", () => server.close());
