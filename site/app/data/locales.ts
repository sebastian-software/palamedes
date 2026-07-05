/*
 * The three-locale booking card — one component, three locales; copy,
 * plurals, currency, and dates change together. Strings mirror the Draft A
 * mock exactly.
 */

export interface LocaleCard {
  locale: string
  title: string
  seats: string
  price: string
  date: string
}

export const LOCALE_CARDS: LocaleCard[] = [
  {
    locale: "en-US",
    title: "Your trip to Lisbon",
    seats: "3 seats left",
    price: "€1,234.00",
    date: "Jul 12, 2026",
  },
  {
    locale: "de-DE",
    title: "Deine Reise nach Lissabon",
    seats: "3 Plätze frei",
    price: "1.234,00 €",
    date: "12. Juli 2026",
  },
  {
    locale: "es-ES",
    title: "Tu viaje a Lisboa",
    seats: "Quedan 3 asientos",
    price: "1234,00 €",
    date: "12 jul 2026",
  },
]

export const LOCALE_CAPTION = "one component · copy, plurals, currency & dates change together"
