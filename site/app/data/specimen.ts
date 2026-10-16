/*
 * The rendered TripCard from the homepage tour, in five locales. Each entry is
 * what the tour's component renders from a translated catalog; plural
 * categories come from Intl.PluralRules so the seat stepper picks the same
 * form the runtime would.
 */

export interface SpecimenLocale {
  /** BCP 47 tag used for `lang` and plural selection. */
  locale: string;
  /** Short switcher label. */
  label: string;
  /** Language name in English, for the accessible switcher label. */
  name: string;
  title: string;
  seats: Partial<Record<Intl.LDMLPluralRule, string>> & { other: string };
}

export const SPECIMEN_LOCALES: readonly SpecimenLocale[] = [
  {
    locale: "en",
    label: "EN",
    name: "English",
    title: "Your trip starts tomorrow.",
    seats: { one: "# seat left", other: "# seats left" },
  },
  {
    locale: "de",
    label: "DE",
    name: "German",
    title: "Deine Reise beginnt morgen.",
    seats: { one: "# Platz frei", other: "# Plätze frei" },
  },
  {
    locale: "es",
    label: "ES",
    name: "Spanish",
    title: "Tu viaje empieza mañana.",
    seats: { one: "Queda # asiento", other: "Quedan # asientos" },
  },
  {
    locale: "fr",
    label: "FR",
    name: "French",
    title: "Votre voyage commence demain.",
    seats: { one: "# place restante", other: "# places restantes" },
  },
  {
    locale: "ja",
    label: "JA",
    name: "Japanese",
    title: "旅は明日から始まります。",
    seats: { other: "残り#席" },
  },
];

export function specimenSeats(entry: SpecimenLocale, count: number): string {
  const category = new Intl.PluralRules(entry.locale).select(count);
  const pattern = entry.seats[category] ?? entry.seats.other;
  return pattern.replace("#", String(count));
}
