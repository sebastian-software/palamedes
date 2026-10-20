import { plural, t } from "@palamedes/core/macro";
import { getI18n } from "@palamedes/runtime";
import { setImmediate } from "node:timers/promises";

const seatsByBooking = new Map([
  ["BK-1", 2],
  ["BK-2", 1],
]);

export async function getBooking(id: string) {
  // Yield across an event-loop turn, as an asynchronous storage lookup would.
  await setImmediate();
  const seats = seatsByBooking.get(id);
  if (seats === undefined) {
    return { code: "BOOKING_NOT_FOUND", message: t`Booking ${id} was not found.` };
  }
  const locale = getI18n().locale;
  const price = new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" }).format(149);
  const date = new Intl.DateTimeFormat(locale, { timeZone: "UTC", dateStyle: "long" }).format(
    new Date("2026-10-18T12:00:00Z"),
  );
  return {
    code: "BOOKING_CONFIRMED",
    id,
    seats,
    amount: 149,
    currency: "EUR",
    startsAt: "2026-10-18T12:00:00Z",
    message: t`Booking ${id} is confirmed.`,
    availability: plural(seats, { one: "# seat available", other: "# seats available" }),
    confirmation: t`Your booking costs ${price} on ${date}.`,
  };
}
