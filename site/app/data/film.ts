/*
 * The homepage film: PalamedesSpace from video/, 1:10, streamed from Bunny
 * Stream (library 783695) with adaptive playback and selectable English
 * captions. The player loads only when someone asks for the film.
 */
const PLAYER = "https://player.mediadelivery.net/embed/783695/6a66741c-dea6-4742-9319-b203e8ac91aa";

export const FILM = {
  id: "6a66741c-dea6-4742-9319-b203e8ac91aa",
  version: "launch-v1",
  title: "Palamedes 2.0 — Launch film",
  duration: "1:10",
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
  "Ask your agent to translate the booking page.",
  "It makes up a key for every string, copies them into every language file, and writes its own loaders and glue code to wire it all up. That's a lot of code for one page.",
  "Let it stand on broader shoulders. With Palamedes, there are no keys. Your agent just writes the sentence.",
  "The wiring is already built, for React, Vue, Svelte, Solid, and the frameworks around them.",
  "And when the agent gets something wrong, it hears about it right away, not from your users.",
  "1,500 files take under a tenth of a second. Tools doing the same job need seconds.",
  "Add the skill, and ask for translations.",
  "Palamedes 2.0, at palamedes.dev.",
];
