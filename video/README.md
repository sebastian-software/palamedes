# Palamedes promo film

The Remotion source in this directory renders two films built from the
palamedes.dev homepage visuals: `PalamedesFilm`, a 2:14 explainer, and
`PalamedesPromo`, a 66-second promo; `PalamedesPoster` is the promo's still. Remotion and React are build-time dependencies
only; the site never ships them. This directory is its own pnpm project and
is not part of the repository workspace.

```sh
pnpm install
pnpm run studio          # preview and scrub the timeline
pnpm run render:picture  # muted picture → audio/.work/out/picture.mp4
pnpm run render:poster   # poster still → audio/.work/out/poster.png
```

## Story and timing

Both films are cut to their score: 84 BPM in 4/4. A cut's scene table in
`src/` and the `plan` in its cue sheet (`audio/cues/*.json`) list the same
bars; `audio/compose.py` writes the score from that plan, and the cue sheet
places the voice on it. Change a scene's length in both together.

The promo has 23 bars (`src/timeline.ts`, `audio/cues/promo.json`):

| Bars  | Scene   | Beat                                                                 |
| ----- | ------- | -------------------------------------------------------------------- |
| 1–4   | Hook    | Keys, a file per language, glue files: the familiar mess             |
| 5–6   | Meet    | The emblem and "Just write the sentence."                            |
| 7–8   | Speak   | One `<Trans>` sentence, six languages                                |
| 9–14  | Journey | Write, extract, translate, build, deliver, render — one stop per bar |
| 15–16 | Wiring  | First-party adapters and the four moments they handle                |
| 17–19 | Rust    | The checked extraction benchmark, played back in real time           |
| 20–21 | Claim   | "Clear. Complete. Fast. Pick three."                                 |
| 22–23 | End     | Emblem, promise, palamedes.dev                                       |

## The long cut

`PalamedesFilm` (`src/film/`) has 47 bars (`src/film/timeline.ts`,
`audio/cues/film.json`) and takes its time to explain each strength:

| Bars  | Scene      | Beat                                                              |
| ----- | ---------- | ----------------------------------------------------------------- |
| 1–2   | Open       | "Your app speaks English. Most of the world doesn't."             |
| 3–7   | Hook       | Keys, a file per language, glue files: the familiar mess          |
| 8–12  | Reveal     | You write, your translators add the languages, your visitors read |
| 13–26 | Journey    | One sentence through extract, translate, build, split and load    |
| 27–32 | Complete   | Plurals and formats, server rendering, `pmds lint`, `pmds audit`  |
| 33–36 | Frameworks | The adapters, each arriving as its name is spoken                 |
| 37–39 | Fast       | The checked extraction benchmark, played back in real time        |
| 40–42 | Agent      | The skill command, then the homepage's prompt typed and sent      |
| 43–44 | Claim      | "Clear, complete, and fast. Pick all three."                      |
| 45–47 | End        | Emblem, promise, palamedes.dev                                    |

The journey is `JourneyFlight` (`src/flight/`), one camera flight over a
world in which the sentence is the protagonist. It also renders on its own
over 12 bars; in the film, `JOURNEY_WARP` maps those bars onto 14 so every
station meets its line. Text that moves collapses into a spark, travels, and
unfolds where it lands (`src/flight/spark.tsx`), so nothing is dragged across
the frame at full size.

`pnpm run render:film` builds the long cut, `pnpm run render:promo` the promo.

## snapcn components

Some motion comes from [snapcn](https://snapcn.dev) (MIT), a shadcn-style
registry of Remotion components. Like shadcn, its source is copied in and is
ours to edit: the core in `src/lib/snap-cn-ui`, the components in
`src/components/snap-cn` (Text Reveal, Text Swap, Cursor Track, Prompt Send,
and Input and Caret for Prompt Send). Both folders stay as upstream ships them
and are excluded from lint and format; the only edits are marked `Palamedes:`
in `prompt-send.tsx` and keep its surfaces flat (ADR-011). `src/snapcn-theme.ts`
re-skins every component with the site palette, zero radius and the brand
faces. The `@/` import alias lives in both `tsconfig.json` and
`remotion.config.ts`, because Remotion's bundler does not read tsconfig paths.

- Headlines arrive on Text Reveal's `soft-blur-in` settings, applied inline in
  the brand faces by `src/kinetic.tsx`.
- In the browser, Text Swap turns the ID into the German sentence in one face,
  and Cursor Track clicks the tab in screen space.
- The agent scene hands over to Prompt Send, which types and sends the prompt.
- All moving type renders with `text-rendering: geometricPrecision`, which
  stops glyphs from snapping to the pixel grid while the camera scales them.

The scenes import their content from the site: `site/app/data/journey.ts`
(real transform and compiler output), `specimen.ts` (the rendered card), and
`bench.ts` (benchmark numbers the site build guards against the checked
report). The film therefore shows no artifact or number the site does not.

The look follows ADR-011: paper, parchment, and mist grounds, navy as ink, one
bronze accent, Cinzel Hellenic from `public/fonts`, and light code listings.
The sans and mono stacks resolve to macOS system fonts (Helvetica Neue,
Menlo), so render on macOS or swap in font files before rendering elsewhere.

## Voice, score, and mix

Remotion renders the picture only. Voice and score are built outside it, so no
model weights or audio binaries live in Git:

```sh
sh audio/setup.sh         # uv env (Chatterbox, Kokoro), soundfonts, once
pnpm run render:promo     # score, voice track, mix, picture, MP4 + SRT
```

Both write to `audio/.work/` (ignored).

- **Voice, long cut:** ElevenLabs Eleven v4 with the premade voice "Brian",
  generated under a paid plan, which grants commercial rights to what is
  generated during the subscription; no real person's voice is cloned.
  `audio/eleven.py <work> audio/lines-film.json --env <path-to-.env>` writes
  seeded takes to `audio/.work/takes/eleven-brian/`. `lines-film.json` spells
  names for the voice ("Pala-meedeez", "Veet"); the cue sheet carries the
  correct spelling for captions. The model sometimes starts the next line after
  a pause, so chosen takes go through `audio/clean.py`, which drops such stray
  bursts, and are saved as `<line>.wav` for the cue sheet. Keep the chosen takes.
- **Voice, promo:** Chatterbox (MIT), conditioned on a synthetic reference spoken by
  one of Kokoro's (Apache-2.0) built-in voices; no real person's voice is
  cloned. `audio/voice.py <work> audio/lines.json --voice <kokoro-voice>`
  writes seeded takes to `audio/.work/takes/<voice>/`. Takes are chosen by ear
  and named in the cue sheet. Generation is not reproducible bit for bit, so
  keep the chosen takes when re-rendering. Kokoro's English pipeline needs the
  spaCy model `en_core_web_sm` matching the installed spaCy version.
- **Score:** an original piano piece with a string pad in D minor, turning to
  F major at the reveal, written as MIDI by `audio/compose.py` and rendered with
  fluidsynth. The piano is the Salamander Grand Piano V3 by Alexander Holm
  (CC BY 3.0); the strings come from MuseScore General (MIT). Credit the
  Salamander piano wherever the film is published.
- **Mix:** the music ducks under the voice and the result is normalised to
  -16 LUFS with a -1.5 dBTP ceiling.

The audio scripts follow the same pipeline as the Dalo promo film.
