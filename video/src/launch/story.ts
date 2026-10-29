/*
 * The illustrated agent session the hook and the pains share: what a coding
 * agent changes to translate one button with a key-based setup. It is a
 * dramatization, not a measurement; the files and keys only show the shape
 * of the problem.
 */
export const PROMPT = "Translate the Book button into German.";

export interface Change {
  file: string;
  added: number;
  removed?: number;
  glue?: boolean;
}

export const CHANGES: readonly Change[] = [
  { file: "src/TripCard.tsx", added: 3, removed: 1 },
  { file: "locales/en.json", added: 1 },
  { file: "locales/de.json", added: 1 },
  { file: "locales/fr.json", added: 1 },
  { file: "locales/es.json", added: 1 },
  { file: "locales/ja.json", added: 1 },
  { file: "locales/ar.json", added: 1 },
  { file: "src/i18n/keys.ts", added: 12 },
  { file: "src/i18n/provider.tsx", added: 38, glue: true },
  { file: "src/i18n/loader.ts", added: 52, glue: true },
  { file: "src/i18n/middleware.ts", added: 44, glue: true },
  { file: "src/i18n/config.ts", added: 19, glue: true },
];

export const FILES = CHANGES.length;
export const ADDED = CHANGES.reduce((sum, change) => sum + change.added, 0);
export const REMOVED = CHANGES.reduce((sum, change) => sum + (change.removed ?? 0), 0);
export const GLUE = CHANGES.filter((change) => change.glue);
export const GLUE_LINES = GLUE.reduce((sum, change) => sum + change.added, 0);

/** The keys the agent invents for the same button, one per catalog it touches. */
export const KEYS = [
  "checkout.cta_v2",
  "booking.button.label",
  "tripCard.book_btn",
  "cta.book.v2",
  "buttons.bookNow",
  "trip_card.book",
] as const;

export const CATALOGS = [
  { file: "locales/en.json", value: "Book" },
  { file: "locales/de.json", value: "Buchen" },
  { file: "locales/fr.json", value: "Réserver" },
  { file: "locales/es.json", value: "Reservar" },
  { file: "locales/ja.json", value: "予約する" },
  { file: "locales/ar.json", value: "احجز" },
] as const;

export const BUTTON_SOURCE = "<button><Trans>Book</Trans></button>";
