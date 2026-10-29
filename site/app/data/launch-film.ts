/** PalamedesSpace from PR #1472, published separately from the product film. */
export const LAUNCH_FILM = {
  id: "WGFXql0mOb8",
  title: "Palamedes 2.0 — Launch film",
  duration: "1:10",
  page: "https://youtu.be/WGFXql0mOb8",
  poster: "/media/palamedes-launch-film-poster.webp",
  embed:
    "https://www.youtube-nocookie.com/embed/WGFXql0mOb8?autoplay=1&playsinline=1&cc_lang_pref=en&cc_load_policy=1",
} as const;

/** The eight narration cues in the launch-v1 archive's timing/space.json. */
export const LAUNCH_FILM_TRANSCRIPT: readonly string[] = [
  "Ask your agent to translate the booking page.",
  "It makes up a key for every string, copies them into every language file, and writes its own loaders and glue code to wire it all up. That's a lot of code for one page.",
  "Let it stand on broader shoulders. With Palamedes, there are no keys. Your agent just writes the sentence.",
  "The wiring is already built, for React, Vue, Svelte, Solid, and the frameworks around them.",
  "And when the agent gets something wrong, it hears about it right away, not from your users.",
  "1,500 files take under a tenth of a second. Tools doing the same job need seconds.",
  "Add the skill, and ask for translations.",
  "Palamedes 2.0, at palamedes.dev.",
];
