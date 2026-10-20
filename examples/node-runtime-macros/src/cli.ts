import { parseArgs } from "node:util";
import { createNodeI18n, defaultLocale, locales } from "./i18n.ts";
import { t } from "@palamedes/core/macro";
import { createServerI18nScope } from "@palamedes/runtime/server";
import { getBooking } from "./booking.ts";
import { selectCliLocale } from "./cli-locale.ts";

let parsed: ReturnType<typeof parseArgs> | undefined;
try {
  parsed = parseArgs({
    options: { locale: { type: "string" }, json: { type: "boolean" }, help: { type: "boolean" } },
    allowPositionals: true,
    strict: true,
  });
} catch {
  // Report syntax errors after choosing the environment's output language.
}
const locale = selectCliLocale(
  process.env,
  typeof parsed?.values.locale === "string" ? parsed.values.locale : undefined,
  locales,
  defaultLocale,
);
const machine = parsed?.values.json === true || process.argv.slice(2).includes("--json");
const scope = createServerI18nScope();
await scope.run(await createNodeI18n({ locale, timeZone: "UTC" }), async () => {
  const args = parsed?.positionals ?? [];
  if (
    !parsed ||
    (!parsed.values.help && args.length > 0 && (args[0] !== "show" || args.length !== 2))
  ) {
    console.error(
      machine
        ? JSON.stringify({ code: "INVALID_ARGUMENTS" })
        : t`Invalid arguments. Run with --help.`,
    );
    process.exitCode = 2;
    return;
  }
  if (parsed.values.help || args.length === 0) {
    if (machine) {
      console.log(JSON.stringify({ command: "show", options: ["--locale", "--json", "--help"] }));
    } else {
      console.log(t`Look up a booking.`);
      console.log("show <id> [--locale <locale>] [--json]\n--help");
    }
    return;
  }
  const booking = await getBooking(args[1]!);
  if (!("id" in booking)) {
    console.error(machine ? JSON.stringify({ code: booking.code }) : booking.message);
    process.exitCode = 1;
    return;
  }
  if (machine) {
    const { code, id, seats, amount, currency, startsAt } = booking;
    console.log(JSON.stringify({ code, id, seats, amount, currency, startsAt }));
  } else {
    console.log(t`Booking details.`);
    console.log([booking.message, booking.availability, booking.confirmation].join("\n"));
  }
});
