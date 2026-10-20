/*
 * The product film is cut to its score: 84 BPM in 4/4, so one bar lasts 240 / 84 s.
 * Scene boundaries and the score plan live in src/film/timeline.ts and
 * audio/cues/film.json. Keep their bar counts aligned.
 */
export const FPS = 30;
export const BPM = 84;
export const BEAT = (60 / BPM) * FPS; // frames per beat
export const BAR = BEAT * 4; // frames per bar
