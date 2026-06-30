/**
 * Shared demo content for the Palamedes example matrix.
 *
 * Every framework demo renders the same fictional booking — "Frontend Stage
 * 2026" — so the ten apps are byte-for-byte the same story. Translatable
 * strings live in each app's `.po` catalogs (that is what Palamedes extracts);
 * the locale-independent facts below live here, once.
 */

export interface EventContent {
  /** Attendee name used in the personalized greeting variable. */
  attendeeName: string
  /** Conference title (a proper noun, intentionally not translated). */
  eventTitle: string
  /** Venue name (a proper noun, intentionally not translated). */
  venueName: string
  /** ISO-8601 start timestamp, formatted per-locale at render time. */
  startsAt: string
  /** A fixed "now" so the relative-time output is stable across runs. */
  referenceNow: string
  /** Price of a single ticket, formatted as currency per-locale. */
  ticketPrice: number
  /** ISO 4217 currency code for the price. */
  currency: string
  /** Remaining seats, rendered through a plural rule. */
  seatsLeft: number
  /** Total registered attendees, rendered through a number format. */
  attendeeCount: number
  /** Maximum tickets a visitor can add at once. */
  maxQuantity: number
}

export const EVENT: EventContent = {
  attendeeName: "Sebastian",
  eventTitle: "Frontend Stage 2026",
  venueName: "Kraftwerk",
  startsAt: "2026-09-18T19:30:00",
  referenceNow: "2026-06-18T12:00:00",
  ticketPrice: 149,
  currency: "EUR",
  seatsLeft: 23,
  attendeeCount: 12_480,
  maxQuantity: 8,
}

/** Whole-month distance from the reference "now" to the event, for relative time. */
export function monthsUntilEvent(content: EventContent = EVENT): number {
  const start = new Date(content.startsAt)
  const now = new Date(content.referenceNow)
  return (start.getFullYear() - now.getFullYear()) * 12 + (start.getMonth() - now.getMonth())
}
