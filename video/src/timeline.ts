/*
 * The promo is cut to its score: 84 BPM in 4/4, so one bar lasts 240 / 84 s.
 * Scene boundaries sit on downbeats; audio/compose.py reads the same plan
 * from audio/cues/promo.json, so change bars here and there together.
 */
export const FPS = 30;
export const BPM = 84;
export const BEAT = (60 / BPM) * FPS; // frames per beat
export const BAR = BEAT * 4; // frames per bar

/** Frame at the start of a bar (1-based) plus an optional beat offset. */
export const bar = (n: number, beat = 0) => Math.round((n - 1) * BAR + beat * BEAT);

export const SCENES = {
  hook: { from: bar(1), to: bar(5) },
  meet: { from: bar(5), to: bar(7) },
  speak: { from: bar(7), to: bar(9) },
  journey: { from: bar(9), to: bar(15) },
  wiring: { from: bar(15), to: bar(17) },
  rust: { from: bar(17), to: bar(20) },
  claim: { from: bar(20), to: bar(22) },
  end: { from: bar(22), to: bar(24) },
} as const;

export const DURATION = SCENES.end.to;
