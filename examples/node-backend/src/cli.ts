import { parseArgs } from "node:util";
import { t } from "@palamedes/core/macro";
import { createServerI18nScope } from "@palamedes/runtime/server";
import { getBooking } from "./booking.ts";
import { selectEnvironmentLocale, selectOverrideLocale } from "./cli-locale.ts";
import { createNodeI18n, defaultLocale, locales } from "./i18n.ts";

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
const machine = parsed?.values.json === true || process.argv.slice(2).includes("--json");
const requested = typeof parsed?.values.locale === "string" ? parsed.values.locale : undefined;
const override = requested === undefined ? undefined : selectOverrideLocale(requested, locales);
const locale = override ?? selectEnvironmentLocale(process.env, locales, defaultLocale);

await createServerI18nScope().run(await createNodeI18n(locale), async () => {
  const args = parsed?.positionals ?? [];
  const fail = (code: string, message: string, exitCode: number) => {
    console.error(machine ? JSON.stringify({ code }) : message);
    process.exitCode = exitCode;
  };
  if (requested !== undefined && override === undefined) {
    const supported = locales.join(", ");
    return fail(
      "UNSUPPORTED_LOCALE",
      t`Unsupported locale "${requested}". Use one of: ${supported}.`,
      2,
    );
  }
  if (
    !parsed ||
    (!parsed.values.help && args.length > 0 && (args[0] !== "show" || args.length !== 2))
  ) {
    return fail("INVALID_ARGUMENTS", t`Invalid arguments. Run with --help.`, 2);
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
  if (!("id" in booking)) return fail(booking.code, booking.message, 1);
  if (machine) {
    const { code, id, seats, amount, currency, startsAt } = booking;
    console.log(JSON.stringify({ code, id, seats, amount, currency, startsAt }));
  } else {
    console.log(t`Booking details.`);
    console.log([booking.message, booking.availability, booking.confirmation].join("\n"));
  }
});
