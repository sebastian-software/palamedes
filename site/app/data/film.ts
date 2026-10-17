/*
 * The homepage film: PalamedesFilm from video/, 2:20. The poster and the
 * captions ship with the site; the captions come from video/audio/captions.py.
 * The MP4 is placed by hand until it moves to its streaming host, and only
 * `src` changes then.
 */
export const FILM = {
  title: "Palamedes in two minutes",
  duration: "2:20",
  src: "/media/palamedes-film.mp4",
  poster: "/media/palamedes-film-poster.webp",
  captions: "/media/palamedes-film.en.vtt",
  width: 1920,
  height: 1080,
} as const;

/** Credits the film carries wherever it is published (CC BY for the piano). */
export const FILM_CREDITS =
  "Narration: a synthetic voice (ElevenLabs). Music: an original score; piano: Salamander Grand Piano V3 by Alexander Holm (CC BY 3.0).";

/** What the narrator says, line by line: the cue sheet's text in video/audio/cues/film.json. */
export const FILM_TRANSCRIPT: readonly string[] = [
  "Your app speaks English. Most of the world doesn't.",
  "Translating an app looks simple, until you spend a minute on the details. One seat, but three seats. Words that change their order. Prices and dates that every language writes its own way. And that's with just two languages.",
  "That's exactly why we built Palamedes. You just write your sentences, right where they're used. Your translators bring the languages, and Palamedes takes care of everything in between.",
  "Here's how it works. That little Trans tag around your sentence is a macro: it looks like plain JSX to you, and your build rewrites it later.",
  "One command lifts every sentence out of your code and into catalog files your translators already know.",
  "They add the translations, and your code stays exactly as it is.",
  "Then your build does the clever part: every sentence becomes a short ID, and every translation becomes ready-to-run code.",
  "The catalog is split into one piece per screen, so each screen loads only its own words, in your visitor's language.",
  "And it doesn't stop there. Plurals, numbers and dates, server rendering and server actions, a linter for your messages and an audit that catches every missing translation: it's one complete toolchain, from the first sentence to the last translation.",
  "The wiring for your framework is already built, for Next.js, React Router, TanStack, Solid, Waku and Vite, and every one of them is tested as a real app.",
  "And it's seriously fast. Its Rust core works through fifteen hundred files in just seventy-three milliseconds.",
  "Working with a coding agent? Add the Palamedes skill and simply ask it to set up translations for you.",
  "Clear, complete, and fast. For once, you get to pick all three.",
  "Palamedes is open source. Get started today at palamedes.dev.",
];
