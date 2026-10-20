# Palamedes product film

This standalone Remotion project contains the current v6 product film: 2:40
at 1920 × 1080 and 30 fps. It is the version published on the homepage through
Bunny Stream and [on YouTube](https://youtu.be/XBECHvmx2qQ).
`PalamedesFilm` is the only film composition; `PalamedesPoster` renders its
poster. The project is outside the repository workspace, and its Remotion and
React dependencies are used only to produce the film.

Run these commands from `video/`:

```sh
pnpm install --frozen-lockfile
pnpm run studio          # preview the film and its poster
pnpm run render:picture  # muted film → audio/.work/out/picture.mp4
pnpm run render:poster   # poster → audio/.work/out/poster.png
pnpm run render:film     # score, chosen voice takes, mix, picture, MP4 + SRT
```

## Story and timing

The film uses 56 bars at 84 BPM in 4/4. `src/film/timeline.ts` defines the
scene boundaries, and `audio/cues/film.json` defines the matching score plan,
voice placement, composition, and output name. Keep the two bar counts aligned.
The shared clock constants live in `src/timeline.ts`.

| Bars  | Scene      | Content                                                                |
| ----- | ---------- | ---------------------------------------------------------------------- |
| 1–2   | Open       | Your app speaks English. Most of the world doesn't.                    |
| 3–8   | Hook       | Plurals, word order, prices, and dates                                 |
| 9–15  | Problems   | Invented keys, whole catalogs, runtime parsing, glue code, slow tools  |
| 16–20 | Reveal     | You write, translators add languages, visitors read                    |
| 21–34 | Journey    | One sentence through extraction, translation, compilation, and loading |
| 35–40 | Complete   | Plurals, formatting, server rendering, lint, and audit                 |
| 41–44 | Frameworks | React and Solid; Next.js, TanStack, Waku, and Remix; Vite              |
| 45–47 | Fast       | The checked extraction benchmark, played back in real time             |
| 48–50 | Agent      | The skill command and setup prompt                                     |
| 51–52 | Claim      | Clear, complete, and fast. Pick all three.                             |
| 53–56 | End        | Palamedes, the website, Sebastian Software, and Sebastian Consulting   |

`src/flight/JourneyFlight.tsx` supplies the camera flight inside the film.
Its 12-bar choreography maps onto the journey's 14 bars through `JOURNEY_WARP`
so each station meets its narration. Moving text folds into a spark, travels,
and unfolds at its destination.

The scenes import the site's real transform/compiler output, specimen, and
benchmark data from `site/app/data/`. The benchmark race excludes React Intl,
whose recorded run covers extraction only. The visual system follows ADR-011:
paper, parchment, and mist backgrounds, navy text, a bronze accent, Cinzel
Hellenic, and light code listings. The sans and mono stacks use macOS system
fonts, so render on macOS or supply equivalent font files before rendering
elsewhere.

## Motion components

Some motion comes from [snapcn](https://snapcn.dev) (MIT). Its copied source is
in `src/lib/snap-cn-ui/` and `src/components/snap-cn/`, excluded from lint and
format. The marked `Palamedes:` edits in `prompt-send.tsx` keep its surfaces
flat. `src/snapcn-theme.ts` supplies the site's palette and typography.

The `@/` alias is defined in both `tsconfig.json` and `remotion.config.ts`.
Text Reveal introduces headlines, Text Swap changes the sentence, Cursor Track
activates the language tab, and Prompt Send types and submits the agent prompt.
Moving type uses `text-rendering: geometricPrecision` to avoid snapping while
the camera scales it.

## Voice, score, captions, and mix

Remotion renders muted picture. Audio scripts write to the ignored
`audio/.work/` directory, or `PALAMEDES_VIDEO_WORK` when set. Keep the chosen
voice takes and final masters archived outside Git: generating new takes is
not a bit-for-bit reproduction of the published narration.

```sh
sh audio/setup.sh
# Generate narration only when new takes are needed; this calls ElevenLabs.
audio/.work/venv/bin/python audio/eleven.py audio/.work audio/lines-film.json --env /path/to/.env
# Select and clean takes with audio/clean.py, saving the names used by the cue sheet.
pnpm run render:film
# Generate short, word-timed WebVTT captions for the same cut.
audio/.work/venv/bin/python audio/captions.py audio/.work audio/cues/film.json audio/.work/out/palamedes-film.en.vtt
```

- **Voice:** ElevenLabs Eleven v4, premade voice Brian, generated under a paid
  plan. No real person's voice is cloned. `audio/eleven.py` writes seeded
  takes; `audio/clean.py` removes stray speech between the selected lines.
  `audio/lines-film.json` uses spoken spellings, while the cue sheet retains
  the spelling used in captions.
- **Score:** an original piano piece with strings, written as MIDI by
  `audio/compose.py` and rendered with fluidsynth. The piano is Salamander
  Grand Piano V3 by Alexander Holm (CC BY 3.0); strings use MuseScore General
  (MIT). Credit the Salamander piano wherever the film is published.
- **Captions:** `audio/captions.py` aligns the cue sheet to the chosen takes
  using faster-whisper, caching word timings beside the audio. It produces
  short WebVTT cues; `audio/assemble.py` also writes SRT during the film build.
- **Mix:** music ducks under narration, with final loudness normalized to
  -16 LUFS and a -1.5 dBTP ceiling.

`audio/setup.sh` installs the MIDI, audio-processing, and caption dependencies
and downloads the two soundfonts. Narration uses the standard-library
ElevenLabs client, so no local text-to-speech models are needed.
