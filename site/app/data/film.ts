/*
 * The homepage film: PalamedesFilm from video/, 2:40, streamed from Bunny
 * Stream (library 783695) with adaptive playback and selectable English
 * captions. The player loads only when someone asks for the film.
 */
const PLAYER = "https://player.mediadelivery.net/embed/783695/df747a2a-efb7-414e-8e67-da6a3be9654f";

export const FILM = {
  title: "Palamedes product film",
  duration: "2:40",
  /** Opens the hosted player page; used as the link when JavaScript is off. */
  page: `${PLAYER}?autoplay=false`,
  /** Loaded into the dialog on click, so playback starts at the reader's request. */
  embed: `${PLAYER}?autoplay=true&preload=true`,
} as const;

/** Credits the film carries wherever it is published (CC BY for the piano). */
export const FILM_CREDITS =
  "Narration: a synthetic voice (ElevenLabs). Music: an original score; piano: Salamander Grand Piano V3 by Alexander Holm (CC BY 3.0).";

/** What the narrator says, line by line: the cue sheet's text in video/audio/cues/film.json. */
export const FILM_TRANSCRIPT: readonly string[] = [
  "Your app speaks English. Most of the world doesn't.",
  "Translating an app looks simple, until you spend a minute on the details. One seat, but three seats. Words that change their order. Prices and dates that every language writes its own way. And that's with just two languages.",
  "And the usual setup makes it harder. You invent a key for every sentence. Every visitor downloads the whole language file. Message syntax gets parsed at runtime, in the browser. Every framework needs its own glue code. And the tools are too slow to run on every save.",
  "That's exactly why we built Palamedes. You just write your sentences, right where they're used. Your translators bring the languages, and Palamedes takes care of everything in between.",
  "Here's how it works. That little Trans tag around your sentence is a macro: it looks like plain JSX to you, and your build rewrites it later.",
  "One command lifts every sentence out of your code and into catalog files your translators already know.",
  "They add the translations, and your code stays exactly as it is.",
  "Then your build does the clever part: every sentence becomes a short ID, and every translation becomes ready-to-run code.",
  "The catalog is split into one piece per screen, so each screen loads only its own words, in your visitor's language.",
  "And it doesn't stop there. Plurals, numbers and dates, server rendering and server actions, a linter for your messages and an audit that catches every missing translation: it's one complete toolchain, from the first sentence to the last translation.",
  "The wiring is already built: for React and Solid, for Next.js, TanStack, Waku and Remix, and for Vite. Every one of them is tested as a real app.",
  "And it's seriously fast. Its Rust core works through fifteen hundred files in just seventy-three milliseconds.",
  "Working with a coding agent? Add the Palamedes skill and simply ask it to set up translations for you.",
  "Clear, complete, and fast. For once, you get to pick all three.",
  "Palamedes is open source. Get started today at palamedes.dev.",
];
