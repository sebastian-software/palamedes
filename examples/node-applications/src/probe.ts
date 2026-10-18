import { createNodeI18n } from "#palamedes/node";
import { createServerI18nScope } from "@palamedes/runtime/server";
import { getBooking } from "./booking.ts";

const scope = createServerI18nScope();
const locale = process.argv[2] ?? "en";
await scope.run(await createNodeI18n({ locale, timeZone: "UTC" }), async () => {
  console.log(JSON.stringify(await getBooking(process.argv[3] ?? "BK-1")));
});
