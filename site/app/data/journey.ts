/*
 * Data for the homepage's guided tour. The sentence is followed through the
 * real toolchain: the macro output below is what transformPalamedesMacros
 * emits for it, and the compiled catalog is renderCatalogModule() output for
 * the same two messages (generated 2026-10-16, formatted for reading — the
 * renderer emits it on one line).
 */

export interface MorphLocale {
  locale: string;
  name: string;
  text: string;
  dir?: "rtl";
}

export const HERO_MESSAGE = "Your trip starts tomorrow.";

export const HERO_MORPH: readonly MorphLocale[] = [
  { locale: "en", name: "English", text: "Your trip starts tomorrow." },
  { locale: "de", name: "German", text: "Deine Reise beginnt morgen." },
  { locale: "es", name: "Spanish", text: "Tu viaje empieza mañana." },
  { locale: "fr", name: "French", text: "Votre voyage commence demain." },
  { locale: "ja", name: "Japanese", text: "旅は明日から始まります。" },
  { locale: "ar", name: "Arabic", text: "رحلتك تبدأ غدًا.", dir: "rtl" },
];

export const JOURNEY_SOURCE = `import { Plural, Trans } from "@palamedes/react/macro"

export function TripCard({ seats }: { seats: number }) {
  return (
    <article>
      <h3><Trans>Your trip starts tomorrow.</Trans></h3>
      <p><Plural value={seats} one="# seat left" other="# seats left" /></p>
    </article>
  )
}`;

export const JOURNEY_PO = `#: src/TripCard.tsx#TripCard
msgid "Your trip starts tomorrow."
msgstr ""

#: src/TripCard.tsx#TripCard
msgid "{seats, plural, one {# seat left} other {# seats left}}"
msgstr ""`;

export const JOURNEY_PO_TRANSLATED = `#: src/TripCard.tsx#TripCard
msgid "Your trip starts tomorrow."
msgstr "Deine Reise beginnt morgen."

#: src/TripCard.tsx#TripCard
msgid "{seats, plural, one {# seat left} other {# seats left}}"
msgstr "{seats, plural, one {# Platz frei} other {# Plätze frei}}"`;

export const JOURNEY_TRANSFORMED = `import { getI18n } from "@palamedes/runtime"
import { Trans } from "@palamedes/react/compiled"

export function TripCard({ seats }: { seats: number }) {
  return (
    <article>
      <h3><Trans id="rPAYxZI1G3I" /></h3>
      <p>{getI18n()._("vqH_FEPt0Hs", { seats })}</p>
    </article>
  )
}`;

export const JOURNEY_COMPILED = `// locales/de — compiled while you build
const one = (v, r, p) => r.join(r.pound(p), " Platz frei")
const other = (v, r, p) => r.join(r.pound(p), " Plätze frei")
const seats = (v, r) => r.plural(v, "seats", 0, "plural", { one, other })

export const messages = defineCompiledCatalog({
  rPAYxZI1G3I: "Deine Reise beginnt morgen.",
  vqH_FEPt0Hs: seats,
})`;
