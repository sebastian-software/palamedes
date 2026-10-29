# Palamedes product film

This standalone Remotion project contains the v7 product film for Palamedes
2.0: 3:06 at 1920 × 1080 and 30 fps. It is published on Bunny Stream as
`b37ad483-9fee-4c09-a0ca-1c7fadc4aaee`; [YouTube](https://youtu.be/XBECHvmx2qQ)
still carries v6 (2:40).
[ARCHIVE.md](ARCHIVE.md) lists where the takes, masters, and published cuts
are kept. `PalamedesFilm` is the long product film; `PalamedesPoster`
renders its poster. Two short launch films sit beside it: `PalamedesSpace`
and its slide-based predecessor `PalamedesLaunch` (see
[Launch films](#launch-films)). The project is outside the repository workspace, and its Remotion and
React dependencies are used only to produce the film.

Run these commands from `video/`:

```sh
pnpm install --frozen-lockfile
pnpm run studio          # preview the film and its poster
pnpm run render:picture  # muted film → audio/.work/out/picture.mp4
pnpm run render:poster   # poster → audio/.work/out/poster.png
pnpm run render:film     # score, chosen voice takes, mix, picture, MP4 + SRT
pnpm run render:space    # the 70 s launch film, supersampled → audio/.work/out/palamedes-space.mp4
```

## Story and timing

The film uses 65 bars at 84 BPM in 4/4. `src/film/timeline.ts` defines the
scene boundaries, and `audio/cues/film.json` defines the matching score plan,
voice placement, composition, and output name. Keep the two bar counts aligned.
The shared clock constants live in `src/timeline.ts`.

| Bars  | Scene      | Content                                                                    |
| ----- | ---------- | -------------------------------------------------------------------------- |
| 1–2   | Open       | Your app speaks English. Most of the world doesn't. The v2.0 lockup.       |
| 3–8   | Hook       | Plurals, word order, prices, and dates                                     |
| 9–15  | Problems   | Invented keys, whole catalogs, runtime parsing, glue code, slow tools      |
| 16–20 | Reveal     | You write, translators add languages, visitors read                        |
| 21–34 | Journey    | One sentence through extraction, translation, compilation, and loading     |
| 35–40 | Complete   | Plurals, formatting, server rendering, lint, and audit                     |
| 41–49 | Frameworks | UI libraries, then the frameworks that host them; 16 marks with examples   |
| 50–55 | Fast       | The checked React, Vue, Svelte, and Solid benchmarks in real time          |
| 56–58 | Agent      | The skill command and setup prompt                                         |
| 59–61 | Claim      | The fastest i18n toolchain. Complete from code to screen. 18 integrations. |
| 62–65 | End        | Palamedes v2.0, the website, Sebastian Software, and Sebastian Consulting  |

`src/flight/JourneyFlight.tsx` supplies the camera flight inside the film.
Its 12-bar choreography maps onto the journey's 14 bars through `JOURNEY_WARP`
so each station meets its narration. Moving text folds into a spark, travels,
and unfolds at its destination.

The scenes import the site's real transform/compiler output, specimen, and
benchmark data from `site/app/data/`; run `pnpm --filter @palamedes/site
prebuild` once so its generated files exist. The benchmark race uses the
site's `benchmarkView()` for each framework: it excludes React Intl, whose
recorded run covers extraction only, and labels tools whose scope is broader. The visual system follows ADR-011:
paper, parchment, and mist backgrounds, navy text, a bronze accent, Cinzel
Hellenic, and light code listings. The sans and mono stacks use macOS system
fonts, so render on macOS or supply equivalent font files before rendering
elsewhere.

## Launch films

`PalamedesSpace` is the 70 s launch film: one camera flight through a 3D
space instead of a sequence of slides. The agent translates a booking page,
and the film names the strengths in turn: no keys, the framework wiring
already built, lint feedback, and speed against tools that do the same job.
`src/space/camera.tsx` holds the camera, which interpolates the eye's position
so fly-throughs never brake at a portal; `src/space/Space.tsx` places every
scene in the world; and `src/space/timeline.ts` holds the 35-bar plan and the
word cues. `PalamedesLaunch` in `src/launch/` is the earlier slide-based cut
that the space film replaced; it is kept for comparison.

Both films use Chris, an ElevenLabs premade voice, and an original piano
deep-house score at 120 BPM, one bar to 2 s. `audio/deep.py` writes and renders
the score from the bar plan in the cue sheet; `audio/build-launch.sh` builds
voice, score, mix, picture, and MP4 from `audio/cues/space.json` or
`audio/cues/launch.json`. The lines live in `audio/lines-space.json` and
`audio/lines-launch.json`, and `audio/eleven.py` generates their takes. Set
`SUPERSAMPLE=2` for a master: it renders at 3840 × 2160 and scales down with
Lanczos, so type that drifts by fractions of a pixel does not shimmer. The build
also writes SRT and word-timed WebVTT captions next to the MP4.

The launch film is a second video, not a new cut of the homepage film. Publish
it with `scripts/publish-bunny.mjs` without `--site`, and pass its own
`--title` and `--cues audio/cues/space.json`; `--site` would point the homepage
at it.

## Publishing to Bunny Stream

The homepage plays the film from Bunny Stream (library 783695). Bunny cannot
replace the file of an existing video, so each cut is published as a new video
and the site switches to its id; the previous video stays as a rollback until
it is deleted in the dashboard. `scripts/publish-bunny.mjs` does the whole
round: create, upload (or let Bunny fetch from an https URL), wait for
encoding, set the poster as thumbnail, add English captions, and with `--site`
rewrite `site/app/data/film.ts` (id, version, duration, transcript from the cue
sheet), copy the poster to `site/public/media`, and update the film line in
`site/analytics.md`.

It needs only the account API key, `BUNNY_API_KEY`, from the environment or an
untracked `--env` file; the library key is read from the account API and never
printed. Always start with a dry run, which only reads from Bunny:

```sh
node scripts/publish-bunny.mjs --dry-run --site --version v7 \
  --file audio/.work/out/palamedes-film.mp4 \
  --poster <poster.webp> --captions audio/.work/out/palamedes-film.en.vtt \
  --env /path/to/.env
```

Drop `--dry-run` to publish, then run the formatter and open a PR for the site
changes.

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
