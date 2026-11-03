import { createLocaleFormatterCache } from "./localeFormatterCache";

/** Snapshot Intl's option properties, including inherited and non-enumerable ones. */
export function createIntlFormatterCache<TOptions extends object, TFormatter>(
  create: (locale: string | undefined, options: TOptions) => TFormatter,
  keys: readonly string[],
): (locale: string | undefined, options: TOptions, overrides?: Partial<TOptions>) => TFormatter {
  const get = createLocaleFormatterCache((locale, key: string) =>
    create(locale, JSON.parse(key) as TOptions),
  );

  return (locale, options, overrides) => {
    const snapshot: Record<string, unknown> = Object.create(null);
    let cacheable = true;
    for (const key of keys) {
      const source = overrides && Object.hasOwn(overrides, key) ? overrides : options;
      const value = (source as Record<string, unknown>)[key];
      if (value === undefined) continue;
      snapshot[key] = value;
      // Preserve Intl's coercion/errors for untyped inputs. JSON would conflate
      // NaN with null and could execute an option object's toJSON method.
      if (
        (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") ||
        (typeof value === "number" && !Number.isFinite(value))
      ) {
        cacheable = false;
      }
    }
    return cacheable ? get(locale, JSON.stringify(snapshot)) : create(locale, snapshot as TOptions);
  };
}

// Include newer Intl options even when the application targets ES2022 typings.
export const NUMBER_FORMAT_KEYS = [
  "compactDisplay",
  "currency",
  "currencyDisplay",
  "currencySign",
  "localeMatcher",
  "maximumFractionDigits",
  "maximumSignificantDigits",
  "minimumFractionDigits",
  "minimumIntegerDigits",
  "minimumSignificantDigits",
  "notation",
  "numberingSystem",
  "roundingIncrement",
  "roundingMode",
  "roundingPriority",
  "signDisplay",
  "style",
  "trailingZeroDisplay",
  "unit",
  "unitDisplay",
  "useGrouping",
] as const;

export const DATE_TIME_FORMAT_KEYS = [
  "calendar",
  "dateStyle",
  "day",
  "dayPeriod",
  "era",
  "formatMatcher",
  "fractionalSecondDigits",
  "hour",
  "hour12",
  "hourCycle",
  "localeMatcher",
  "minute",
  "month",
  "numberingSystem",
  "second",
  "timeStyle",
  "timeZone",
  "timeZoneName",
  "weekday",
  "year",
] as const satisfies readonly (keyof Intl.DateTimeFormatOptions)[];
