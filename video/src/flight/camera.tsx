import type { ReactNode } from "react";
import { Easing, interpolate } from "remotion";

/*
 * A camera over a 2D world: each key says which world point sits at the
 * centre of the frame, at what zoom. Moves between keys ease in and out;
 * fast moves pick up a little blur, like a whip pan. Adapted from the Dalo
 * promo film.
 */
export interface CamKey {
  f: number;
  x: number;
  y: number;
  z: number;
  ease?: (t: number) => number;
}

const W = 1920;
const H = 1080;
const WHIP = Easing.bezier(0.7, 0, 0.2, 1);

export function cameraAt(keys: readonly CamKey[], frame: number): CamKey {
  const first = keys[0];
  const last = keys.at(-1);
  if (!first || !last) throw new Error("A camera needs at least one key.");
  if (frame <= first.f) return first;
  for (let index = 0; index < keys.length - 1; index += 1) {
    const a = keys[index];
    const b = keys[index + 1];
    if (a && b && frame <= b.f) {
      const t = interpolate(frame, [a.f, b.f], [0, 1], { easing: b.ease ?? WHIP });
      // Zoom in log space so it feels linear to the eye.
      const z = Math.exp(Math.log(a.z) + (Math.log(b.z) - Math.log(a.z)) * t);
      return { f: frame, x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z };
    }
  }
  return last;
}

export function Camera({
  keys,
  frame,
  children,
}: {
  keys: readonly CamKey[];
  frame: number;
  children: ReactNode;
}) {
  const now = cameraAt(keys, frame);
  const before = cameraAt(keys, frame - 1);
  // Screen-space speed in px per frame.
  const speed =
    Math.hypot((now.x - before.x) * now.z, (now.y - before.y) * now.z) +
    Math.abs(Math.log(now.z / before.z)) * 900;
  const blur = Math.min(5, Math.max(0, speed - 34) * 0.05);
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: W,
        height: H,
        transformOrigin: "0 0",
        transform: `translate(${W / 2}px, ${H / 2}px) scale(${now.z}) translate(${-now.x}px, ${-now.y}px)`,
        filter: blur > 0.3 ? `blur(${blur.toFixed(2)}px)` : undefined,
        // Type stays steady while the world scales: no hinting, no pixel snapping.
        textRendering: "geometricPrecision",
        WebkitFontSmoothing: "antialiased",
      }}
    >
      {children}
    </div>
  );
}
