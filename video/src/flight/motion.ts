import { Easing, interpolate, spring } from "remotion";

import { FPS } from "../timeline";

/*
 * Motion helpers for the camera scenes: eased ramps, springs, flight arcs
 * and the character scramble that turns a sentence into an ID and back.
 */
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

export type Point = readonly [number, number];

/** 0 → 1 between two frames, eased in and out. */
export function ramp(
  frame: number,
  from: number,
  to: number,
  easing: (t: number) => number = Easing.inOut(Easing.cubic),
): number {
  return interpolate(frame, [from, to], [0, 1], { ...clamp, easing });
}

/** A spring that starts at a given frame. */
export function pop(
  frame: number,
  at: number,
  config: { damping?: number; stiffness?: number; mass?: number } = {},
): number {
  return spring({
    frame: frame - at,
    fps: FPS,
    config: { damping: 14, stiffness: 140, mass: 0.8, ...config },
  });
}

export const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/** A point on a cubic arc from one point to another, lifted at its middle. */
export function arc(from: Point, to: Point, t: number, lift = 240): Point {
  const top = Math.min(from[1], to[1]) - lift;
  const p1: Point = [mix(from[0], to[0], 0.25), top];
  const p2: Point = [mix(from[0], to[0], 0.75), top];
  const u = 1 - t;
  const x = u ** 3 * from[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t ** 3 * to[0];
  const y = u ** 3 * from[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t ** 3 * to[1];
  return [x, y];
}

const ID_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-";

function noise(i: number, j: number): number {
  let h = Math.imul(i, 374_761_393) ^ Math.imul(j, 668_265_263) ^ 0x5b_f0_36_35;
  h = Math.imul(h ^ (h >>> 13), 1_274_126_177);
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * Morph one string into another: characters start to tumble from left to
 * right and settle on their target in the same order.
 */
export function scramble(from: string, to: string, t: number, frame: number, seed = 0): string {
  if (t <= 0) return from;
  if (t >= 1) return to;
  const length = Math.round(mix(from.length, to.length, t));
  let out = "";
  for (let index = 0; index < length; index += 1) {
    const order = length > 1 ? index / (length - 1) : 0;
    if (t >= 0.35 + order * 0.6) out += to[index] ?? " ";
    else if (t >= order * 0.3)
      out += ID_CHARS[noise(index + seed * 131, Math.floor(frame / 2)) % ID_CHARS.length];
    else out += from[index] ?? " ";
  }
  return out;
}

/** Reveal text character by character between two frames. */
export function typed(text: string, frame: number, start: number, duration: number): string {
  const count = Math.round(interpolate(frame, [start, start + duration], [0, text.length], clamp));
  return text.slice(0, count);
}
