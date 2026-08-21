export type MessageFormat = "number" | "date" | "time"

const numberFormatCache = new Map<string, Intl.NumberFormat>()
const pluralRulesCache = new Map<string, Intl.PluralRules>()
const dateTimeFormatCache = new Map<string, Intl.DateTimeFormat>()

// Intl instances are keyed by (locale, style): a handful per app, so a small
// bound is plenty and keeps the retained memory of these heavy objects low.
const FORMATTER_CACHE_LIMIT = 64

export function formatMessageArgument(
  format: MessageFormat,
  value: unknown,
  style?: string,
  locale?: string,
  timeZone?: string
): string {
  if (format === "number") {
    const numericValue = normalizeFormattedNumberValue(value)
    if (numericValue === undefined) {
      return stringifyValue(value)
    }

    return getNumberFormatter(locale, style).format(numericValue)
  }

  const dateValue = normalizeDateValue(value)
  if (!dateValue) {
    return stringifyValue(value)
  }

  return getDateTimeFormatter(locale, format, style, timeZone).format(dateValue)
}

function getNumberFormatter(
  locale: string | undefined,
  style: string | undefined
): Intl.NumberFormat {
  const cacheKey = `${locale ?? ""}\0${style ?? ""}`
  const cached = numberFormatCache.get(cacheKey)
  if (cached) {
    return cached
  }

  const formatter = new Intl.NumberFormat(locale, parseNumberFormatOptions(style))
  return rememberFormatter(numberFormatCache, cacheKey, formatter)
}

function parseNumberFormatOptions(style: string | undefined): Intl.NumberFormatOptions {
  const normalized = style?.trim()
  if (!normalized) {
    return {}
  }

  const skeleton = normalized.startsWith("::") ? normalized.slice(2) : normalized

  if (skeleton === "percent") {
    return { style: "percent" }
  }

  if (skeleton === "integer") {
    return { maximumFractionDigits: 0 }
  }

  if (!normalized.startsWith("::")) {
    return {}
  }

  if (!skeleton.startsWith("currency/")) {
    return {}
  }

  const currency = skeleton.slice("currency/".length).trim().toUpperCase()
  if (/^[A-Z]{3}$/.test(currency)) {
    return {
      style: "currency",
      currency,
    }
  }

  return {}
}

function normalizeDateValue(value: unknown): Date | undefined {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? undefined : value
  }

  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? undefined : date
  }

  return undefined
}

function getDateTimeFormatter(
  locale: string | undefined,
  format: "date" | "time",
  style: string | undefined,
  timeZone: string | undefined
): Intl.DateTimeFormat {
  const normalizedStyle = normalizeDateTimeStyle(style, format)
  const cacheKey = `${locale ?? ""}\0${format}\0${normalizedStyle ?? ""}\0${timeZone ?? ""}`
  const cached = dateTimeFormatCache.get(cacheKey)
  if (cached) {
    return cached
  }

  const options: Intl.DateTimeFormatOptions =
    format === "date"
      ? { dateStyle: normalizedStyle, timeZone }
      : { timeStyle: normalizedStyle, timeZone }
  const formatter = new Intl.DateTimeFormat(locale, options)
  return rememberFormatter(dateTimeFormatCache, cacheKey, formatter)
}

function normalizeDateTimeStyle(
  style: string | undefined,
  format: "date" | "time"
): "full" | "long" | "medium" | "short" | undefined {
  if (style === "full" || style === "long" || style === "medium" || style === "short") {
    return style
  }

  return format === "time" ? "short" : undefined
}

export function requireChoiceNumericValue(variable: string, kind: string, value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value
  }

  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }

  throw new Error(
    `Missing or non-numeric value for {${variable}, ${kind}, …}: received ${describeValue(value)}.`
  )
}

function describeValue(value: unknown): string {
  if (value === undefined) {
    return "undefined"
  }
  if (value === null) {
    return "null"
  }
  return typeof value === "string" ? `"${value}"` : String(value)
}

function normalizeFormattedNumberValue(value: unknown): number | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }

  return undefined
}

function getPluralRules(locale: string | undefined, kind: string): Intl.PluralRules {
  const type = kind === "selectordinal" ? "ordinal" : "cardinal"
  const cacheKey = `${locale ?? ""}\0${type}`
  const cached = pluralRulesCache.get(cacheKey)
  if (cached) {
    return cached
  }
  return rememberFormatter(pluralRulesCache, cacheKey, new Intl.PluralRules(locale, { type }))
}

export function selectPluralCategory(
  value: number,
  locale: string | undefined,
  kind: "plural" | "selectordinal"
): Intl.LDMLPluralRule {
  return getPluralRules(locale, kind).select(value)
}

function rememberFormatter<TFormatter>(
  cache: Map<string, TFormatter>,
  key: string,
  formatter: TFormatter
): TFormatter {
  if (!cache.has(key) && cache.size >= FORMATTER_CACHE_LIMIT) {
    const oldestKey = cache.keys().next().value
    if (oldestKey !== undefined) {
      cache.delete(oldestKey)
    }
  }

  cache.set(key, formatter)
  return formatter
}

export function replacePoundPlaceholders(
  value: string,
  numericValue: number,
  locale?: string
): string {
  return value.replaceAll("#", getNumberFormatter(locale, undefined).format(numericValue))
}

export function stringifyValue(value: unknown): string {
  if (value === null || value === undefined) {
    return ""
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value)
  }

  if (value instanceof Date) {
    // An invalid Date degrades to "Invalid Date" instead of letting
    // toISOString() throw and abort adapter rendering.
    return Number.isNaN(value.getTime()) ? String(value) : value.toISOString()
  }

  return String(value)
}
