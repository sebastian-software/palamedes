import { FPS } from "../timeline";

/*
 * The launch cut: 35 bars at 120 BPM, so one bar is exactly 2 s (60 frames)
 * and one beat 15 frames. audio/cues/launch.json holds the same bar plan for
 * the score and places Chris's takes on it; change bars in both together.
 */
export const BPM = 120;
export const BEAT = (60 / BPM) * FPS;
export const BAR = BEAT * 4;
export const S16 = BEAT / 4;

const SECTIONS = [
  ["hook", 4],
  ["pains", 6],
  ["reveal", 2],
  ["lockup", 1],
  ["check", 4],
  ["fast", 4],
  ["stack", 6],
  ["skill", 4],
  ["end", 4],
] as const;

export type LaunchSection = (typeof SECTIONS)[number][0];

export const SCENES = Object.fromEntries(
  SECTIONS.reduce<[LaunchSection, { from: number; to: number; bars: number }][]>(
    (list, [name, bars]) => {
      const from = list.at(-1)?.[1].to ?? 0;
      list.push([name, { from, to: from + bars * BAR, bars }]);
      return list;
    },
    [],
  ),
) as Record<LaunchSection, { from: number; to: number; bars: number }>;

export const LAUNCH_DURATION = SCENES.end.to;

/*
 * Word cues in film seconds: each take's start in the cue sheet plus the
 * word's start in the cleaned take (faster-whisper word timings).
 */
export const WORDS = {
  button: 2.86,
  key: 9.02,
  edits: 9.72,
  ships: 11.48,
  plural: 12,
  writesGlue: 13.74,
  glue: 14.36,
  need: 15.74,
  painsEnd: 16.2,
  palamedes: 20.58,
  writes: 22.46,
  sentence: 23.08,
  agentCheck: 26.82,
  wrong: 27.58,
  hears: 28.48,
  rightAway: 29.18,
  notUsers: 30.28,
  files: 34.74,
  tenth: 36.26,
  nextFastest: 37.8,
  noGlue: 42.94,
  react: 45.24,
  vue: 46.02,
  svelte: 46.58,
  solid: 47.28,
  frameworks: 48.04,
  built: 49.66,
  skill: 54.98,
  ask: 55.74,
  name: 62.54,
  version: 63.02,
  domain: 64.32,
} as const;

/** A film-time cue as a frame inside a scene. */
export const cue = (seconds: number, section: LaunchSection) =>
  Math.round(seconds * FPS) - SCENES[section].from;
