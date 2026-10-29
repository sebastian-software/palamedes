# Product film: sources, archive, and publishing

Where everything for the product film lives, and how to pick it up again
after a few weeks. The README explains how the film is built; this page
explains what is kept outside Git and where each published cut is.

## Where things are

| What                                           | Where                                                                                    |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Scenes, timing, spoken script, cue sheet       | This repository: `video/` (`src/`, `audio/lines-film.json`, `audio/cues/film.json`)      |
| Chosen voice takes, raw takes, word timings    | NAS archive, one dated folder per cut (below)                                            |
| Masters, captions, posters, audio stems        | NAS archive, `master/` and `stems/`                                                      |
| YouTube upload package (texts, SRT, thumbnail) | NAS archive, `youtube/`                                                                  |
| Published video for the homepage               | Bunny Stream, library 783695; the current id is in `site/app/data/film.ts`               |
| Published video on YouTube                     | https://youtu.be/XBECHvmx2qQ (still v6)                                                  |
| API keys                                       | `ELEVENLABS_API_KEY` and `BUNNY_API_KEY` in the untracked `.env` of the primary checkout |
| Build output while working                     | `video/audio/.work/` (ignored by Git, lost with the worktree)                            |

The NAS archive is Sebastian's network share, `Projekte/Palamedes/Produktfilm/`
(mounted on macOS as `/Volumes/home/sebastian/Projekte/Palamedes/Produktfilm/`).
Each cut has a folder named `<date> v<N>` with its own `README.md` and a
`SHA256SUMS` file; check a folder with `shasum -a 256 -c SHA256SUMS`.

## Cuts

| Cut       | Archive folder                                                 | Length | Source commit      | Bunny id                               | YouTube                                 |
| --------- | -------------------------------------------------------------- | ------ | ------------------ | -------------------------------------- | --------------------------------------- |
| v7        | `2026-10-26 v7 (Palamedes 2.0)`                                | 3:06   | `404568f3` (#1361) | `b37ad483-9fee-4c09-a0ca-1c7fadc4aaee` | package ready, not uploaded             |
| v6        | `2026-10-19 v6`                                                | 2:40   | #1259              | `df747a2a-efb7-414e-8e67-da6a3be9654f` | https://youtu.be/XBECHvmx2qQ            |
| launch-v1 | `2026-10-29 launch v1 (Palamedes 2.0)` (local release package) | 1:10   | `b1a5a40b` (#1472) | —                                      | https://youtu.be/WGFXql0mOb8 (unlisted) |

The launch film is an additional homepage video, embedded from YouTube through
`site/app/data/launch-film.ts`. Its English SRT captions and PNG thumbnail were
uploaded with the master. The source package's `SHA256SUMS` passed verification;
its NAS copy has not been verified. The product film above keeps its Bunny player.

The v7 archive holds everything needed to rebuild the cut without
ElevenLabs: the 15 chosen takes (`takes/`), every delivered take
(`takes-raw/`), word timings and the script and cue sheet as published
(`timing/`), masters, stems, and the YouTube package. The v6 takes were lost;
its folder keeps the master, captions, poster, and word timings transcribed
from the final mix (`timing/words-from-mix.json`), which v7's narration was
aligned to.

## Open items

- Upload v7 to YouTube by hand from the `youtube/` package. Uploads through
  the YouTube Data API from an unverified project are locked to private, so
  the API is not used. Afterwards, replace the YouTube link here and in the
  README, and set v6 to unlisted.
- Delete the v6 video in Bunny Stream once v7 has run on the homepage without
  problems; until then it is the rollback.

## Rebuild a cut from the archive

From `video/` at the cut's source commit:

```sh
sh audio/setup.sh
mkdir -p audio/.work/takes/eleven-brian
cp "<archive>/takes/"*.wav "<archive>/timing/words.json" audio/.work/takes/eleven-brian/
pnpm --filter @palamedes/site prebuild   # benchmark data for the speed scene
sh audio/build.sh audio/cues/film.json
```

To change a single line, generate takes for that line only with
`audio/eleven.py`, clean the chosen one with `audio/clean.py`, save it under
the line's name in `audio/.work/takes/eleven-brian/`, and adjust its `at` in
`audio/cues/film.json`. Everything else keeps the archived takes.

## Releasing a new cut

1. Build the film (`pnpm run render:film`) and the captions (README, "Voice,
   score, captions, and mix").
2. Archive it on the NAS in a new folder `<date> v<N>`: `takes/`,
   `takes-raw/`, `timing/` (with `commit.txt`), `master/`, `stems/`, a
   `README.md` like the previous cut's, and `SHA256SUMS`.
3. Publish to Bunny with `scripts/publish-bunny.mjs --site` (README,
   "Publishing to Bunny Stream"), dry run first, and open a PR for the site
   changes.
4. Prepare the YouTube package in the archive's `youtube/` folder and upload
   it by hand.
5. Update the tables on this page.
