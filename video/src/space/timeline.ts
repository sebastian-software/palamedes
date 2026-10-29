import { BAR } from "../launch/timeline";
import { FPS } from "../timeline";

/*
 * The space film: 35 bars at 120 BPM (2 s each). audio/cues/space.json holds
 * the same bar plan for the score and places Chris's takes on it; change bars
 * in both together.
 */
const SECTIONS = [
  ["hook", 3],
  ["pains", 6],
  ["reveal", 4],
  ["ring", 4],
  ["check", 4],
  ["fast", 4],
  ["skill", 3],
  ["end", 3],
  ["makers", 4],
] as const;

export type SpaceSection = (typeof SECTIONS)[number][0];

export const SCENES = Object.fromEntries(
  SECTIONS.reduce<[SpaceSection, { from: number; to: number }][]>((list, [name, bars]) => {
    const from = list.at(-1)?.[1].to ?? 0;
    list.push([name, { from, to: from + bars * BAR }]);
    return list;
  }, []),
) as Record<SpaceSection, { from: number; to: number }>;

export const SPACE_DURATION = SCENES.makers.to;

/*
 * Word cues in film seconds: each take's start in the cue sheet plus the
 * word's start in the cleaned take (faster-whisper word timings).
 */
export const WORDS = {
  page: 3,
  key: 6.96,
  string: 7.78,
  copies: 8.7,
  language: 9.78,
  writes: 10.96,
  loaders: 11.64,
  glue: 12.32,
  lot: 14.78,
  page2: 16.04,
  shoulders: 19.62,
  palamedes: 20.9,
  keys: 22.48,
  writesSentence: 24.06,
  sentence: 24.64,
  built: 28.16,
  react: 29.06,
  vue: 29.86,
  svelte: 30.4,
  solid: 31.12,
  frameworks: 32.04,
  wrong: 35.78,
  hears: 36.68,
  rightAway: 37.38,
  notUsers: 38.48,
  files: 43.02,
  tenth: 44.54,
  tools: 46.04,
  seconds: 47.68,
  skill: 50.98,
  ask: 51.74,
  name: 56.54,
  version: 57.02,
  domain: 58.32,
} as const;

export const at = (seconds: number) => Math.round(seconds * FPS);
