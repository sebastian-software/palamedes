/*
 * The homepage film: PalamedesFilm from video/, 3:06, streamed from Bunny
 * Stream (library 783695) with adaptive playback and selectable English
 * captions. The player loads only when someone asks for the film.
 */
const PLAYER = "https://player.mediadelivery.net/embed/783695/b37ad483-9fee-4c09-a0ca-1c7fadc4aaee";

export const FILM = {
  id: "b37ad483-9fee-4c09-a0ca-1c7fadc4aaee",
  version: "v7",
  title: "Palamedes product film",
  duration: "3:06",
  /** Opens the hosted player page; used as the link when JavaScript is off. */
  page: `${PLAYER}?autoplay=false`,
  /** A still from the film, shown until someone presses play. */
  poster: "/media/palamedes-film-poster.webp",
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
  "The wiring is already built: for React, Solid, Vue and Svelte. And not just on their own: inside Next.js, Nuxt, SvelteKit, TanStack, React Router, Waku and Remix, too. And beyond the browser, for backends, command-line tools, MDX docs and Rust. Each one comes with a working example.",
  "And it's seriously fast, in every one of them. Its Rust core works through fifteen hundred files in about a tenth of a second. The next-fastest tool needs over two seconds.",
  "Working with a coding agent? Add the Palamedes skill and simply ask it to set up translations for you.",
  "The fastest i18n toolchain. Complete from code to screen, and proven in eighteen integrations.",
  "Palamedes 2.0 is open source. Get started today at palamedes.dev.",
];
