# Palamedes promo film

The Remotion source in this directory renders `PalamedesPromo`, a 66-second
1920×1080 marketing film built from the palamedes.dev homepage visuals, and
`PalamedesPoster`, its still. Remotion and React are build-time dependencies
only; the site never ships them. This directory is its own pnpm project and
is not part of the repository workspace.

```sh
pnpm install
pnpm run studio          # preview and scrub the timeline
pnpm run render:picture  # muted picture → audio/.work/out/picture.mp4
pnpm run render:poster   # poster still → audio/.work/out/poster.png
```

## Story and timing

The film is cut to its score: 84 BPM in 4/4, 23 bars. `src/timeline.ts` holds
the bar plan; `audio/compose.py` writes the score from the same plan, and
`audio/cues/promo.json` places the voice on it. Change a scene's length in all
three together.

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

- **Voice:** Chatterbox (MIT), conditioned on a synthetic reference spoken by
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
