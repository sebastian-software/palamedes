import { plural, t } from "@palamedes/core/macro";
import { getI18n } from "@palamedes/runtime";
import { setImmediate } from "node:timers/promises";

const bookings: Record<string, { seats: number; amount: number }> = {
  "BK-1": { seats: 2, amount: 149 },
  "BK-2": { seats: 1, amount: 79 },
};

export async function getBooking(id: string) {
  // Yield across an event-loop turn, as an asynchronous storage lookup would.
  await setImmediate();
  const booking = Object.hasOwn(bookings, id) ? bookings[id] : undefined;
  if (!booking) {
    return { code: "BOOKING_NOT_FOUND", message: t`Booking ${id} was not found.` };
  }
  const { seats, amount } = booking;
  const locale = getI18n().locale;
  const price = new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" }).format(
    amount,
  );
  const date = new Intl.DateTimeFormat(locale, { timeZone: "UTC", dateStyle: "long" }).format(
    new Date("2026-10-18T12:00:00Z"),
  );
  return {
    code: "BOOKING_CONFIRMED",
    id,
    seats,
    amount,
    currency: "EUR",
    startsAt: "2026-10-18T12:00:00Z",
    message: t`Booking ${id} is confirmed.`,
    availability: plural(seats, { one: "# seat available", other: "# seats available" }),
    confirmation: t`Your booking costs ${price} on ${date}.`,
  };
}
