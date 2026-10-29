import { createContext, type CSSProperties, type ReactNode, useContext } from "react";
import { AbsoluteFill } from "remotion";

/*
 * A real 3D camera for the launch film: the world is one CSS 3D scene and the
 * camera flies through it, so planes keep their perspective, depth layers
 * slide past one another, and far things fade into the paper. A shot names
 * the world point at the centre of the frame, the camera's distance from it,
 * and its yaw, pitch and roll. Shots are joined by a smooth spline, so the
 * camera never stops on a key unless a key asks it to.
 */
export type Vec = readonly [number, number, number];

export interface Shot {
  f: number;
  at: Vec;
  dist: number;
  yaw?: number;
  pitch?: number;
  roll?: number;
  /** Arrive at rest instead of flowing through this key. */
  stop?: boolean;
}

interface Pose {
  at: Vec;
  dist: number;
  yaw: number;
  pitch: number;
  roll: number;
}

/** CSS perspective: at this distance a world pixel is a screen pixel. */
export const LENS = 1400;
const W = 1920;
const H = 1080;

/** Unit vector from the shot's target back to the eye. */
function back(yaw: number, pitch: number): Vec {
  const y = (yaw * Math.PI) / 180;
  const p = (pitch * Math.PI) / 180;
  return [-Math.cos(p) * Math.sin(y), -Math.sin(p), Math.cos(p) * Math.cos(y)];
}

/*
 * Keys are interpolated by the eye's position, not by target and distance:
 * a fly-through that hands over from one target to the next keeps the eye
 * moving instead of braking to a halt at the portal.
 */
const channels = (shot: Shot) => {
  const yaw = shot.yaw ?? 0;
  const pitch = shot.pitch ?? 0;
  const b = back(yaw, pitch);
  return [
    shot.at[0] + b[0] * shot.dist,
    shot.at[1] + b[1] * shot.dist,
    shot.at[2] + b[2] * shot.dist,
    Math.log(shot.dist),
    yaw,
    pitch,
    shot.roll ?? 0,
  ];
};

/** Cubic Hermite through the keys with monotone tangents. */
export function poseAt(shots: readonly Shot[], frame: number): Pose {
  const first = shots[0];
  const last = shots.at(-1);
  if (!first || !last) throw new Error("A camera needs at least one shot.");
  const pose = (values: number[]): Pose => {
    const dist = Math.exp(values[3] ?? 0);
    const yaw = values[4] ?? 0;
    const pitch = values[5] ?? 0;
    const toEye = back(yaw, pitch);
    return {
      at: [
        (values[0] ?? 0) - toEye[0] * dist,
        (values[1] ?? 0) - toEye[1] * dist,
        (values[2] ?? 0) - toEye[2] * dist,
      ],
      dist,
      yaw,
      pitch,
      roll: values[6] ?? 0,
    };
  };
  if (frame <= first.f) return pose(channels(first));
  if (frame >= last.f) return pose(channels(last));
  const index = shots.findIndex((shot, i) => i > 0 && frame <= shot.f) - 1;
  const a = shots[index] as Shot;
  const b = shots[index + 1] as Shot;
  const before = shots[index - 1];
  const after = shots[index + 2];
  const span = b.f - a.f;
  const t = (frame - a.f) / span;
  const pa = channels(a);
  const pb = channels(b);
  // Monotone tangents (harmonic mean of the slopes on both sides): the camera
  // flows through a key but never overshoots it, even on a long, quick move.
  const tangent = (key: Shot, prev: Shot | undefined, next: Shot | undefined, i: number) => {
    if (key.stop || !prev || !next) return 0;
    const here = channels(key)[i] ?? 0;
    const into = (here - (channels(prev)[i] ?? 0)) / (key.f - prev.f);
    const out = ((channels(next)[i] ?? 0) - here) / (next.f - key.f);
    if (into * out <= 0) return 0;
    return 2 / (1 / into + 1 / out);
  };
  const h00 = 2 * t ** 3 - 3 * t ** 2 + 1;
  const h10 = t ** 3 - 2 * t ** 2 + t;
  const h01 = -2 * t ** 3 + 3 * t ** 2;
  const h11 = t ** 3 - t ** 2;
  return pose(
    pa.map(
      (value, i) =>
        h00 * value +
        h10 * span * tangent(a, before, b, i) +
        h01 * (pb[i] ?? 0) +
        h11 * span * tangent(b, a, after, i),
    ),
  );
}

/** A world point in camera space: screen-plane offsets and depth from the eye. */
export function viewOf(pose: Pose, p: Vec): Vec {
  const x = p[0] - pose.at[0];
  const y = p[1] - pose.at[1];
  const z = p[2] - pose.at[2];
  const yaw = (pose.yaw * Math.PI) / 180;
  const pitch = (-pose.pitch * Math.PI) / 180;
  const x1 = x * Math.cos(yaw) + z * Math.sin(yaw);
  const z1 = -x * Math.sin(yaw) + z * Math.cos(yaw);
  const y2 = y * Math.cos(pitch) - z1 * Math.sin(pitch);
  const z2 = y * Math.sin(pitch) + z1 * Math.cos(pitch);
  return [x1, y2, pose.dist - z2];
}

/** Distance from the eye to a world point, along the view axis. */
export function depthOf(pose: Pose, p: Vec): number {
  const x = p[0] - pose.at[0];
  const y = p[1] - pose.at[1];
  const z = p[2] - pose.at[2];
  const yaw = (pose.yaw * Math.PI) / 180;
  const pitch = (-pose.pitch * Math.PI) / 180;
  const z1 = -x * Math.sin(yaw) + z * Math.cos(yaw);
  const z2 = y * Math.sin(pitch) + z1 * Math.cos(pitch);
  return pose.dist - z2;
}

/**
 * A place that faces its own way: things inside it are given in local
 * coordinates (x right, y down, z toward its camera) and turned by its yaw,
 * so the camera can turn a corner into the next world.
 */
export interface Place {
  o: Vec;
  yaw: number;
}

/** A local point of a place, in world coordinates. */
export function toWorld(place: Place, p: Vec): Vec {
  const t = (place.yaw * Math.PI) / 180;
  return [
    place.o[0] + p[0] * Math.cos(t) - p[2] * Math.sin(t),
    place.o[1] + p[1],
    place.o[2] + p[0] * Math.sin(t) + p[2] * Math.cos(t),
  ];
}

const PlaceContext = createContext<Place>({ o: [0, 0, 0], yaw: 0 });

export function Station({ place, children }: { place: Place; children: ReactNode }) {
  return <PlaceContext.Provider value={place}>{children}</PlaceContext.Provider>;
}

const PoseContext = createContext<Pose>({ at: [0, 0, 0], dist: LENS, yaw: 0, pitch: 0, roll: 0 });

export const usePose = () => useContext(PoseContext);

/** Fade toward the paper with distance, and away as a thing passes the lens. */
export function fog(depth: number, far = 9000): number {
  const near = Math.min(1, Math.max(0, (depth - 120) / 380));
  const distant = 1 - Math.min(1, Math.max(0, (depth - far * 0.45) / (far * 0.55)));
  return near * distant;
}

/**
 * 1 in the middle of the frame, 0 near its edge: what the shot is not about
 * fades out before the frame can cut it in half.
 */
export function inFrame(pose: Pose, p: Vec, extent = 0): number {
  const [vx, vy, depth] = viewOf(pose, p);
  const k = LENS / Math.max(1, depth);
  const x = (Math.abs(vx * k) + extent * k) / (W / 2);
  const y = (Math.abs(vy * k) + extent * 0.4 * k) / (H / 2);
  const fade = (value: number, from: number, to: number) =>
    1 - Math.min(1, Math.max(0, (value - from) / (to - from)));
  return fade(x, 0.72, 0.96) * fade(y, 0.68, 0.94);
}

export function World({
  shots,
  frame,
  ground,
  children,
}: {
  shots: readonly Shot[];
  frame: number;
  ground: string;
  children: ReactNode;
}) {
  const pose = poseAt(shots, frame);
  return (
    <AbsoluteFill
      style={{
        background: ground,
        overflow: "hidden",
        perspective: `${LENS}px`,
        perspectiveOrigin: "50% 50%",
      }}
    >
      <div
        style={{
          position: "absolute",
          left: W / 2,
          top: H / 2,
          transformStyle: "preserve-3d",
          transform: `translateZ(${LENS - pose.dist}px) rotateZ(${pose.roll}deg) rotateX(${-pose.pitch}deg) rotateY(${pose.yaw}deg) translate3d(${-pose.at[0]}px, ${-pose.at[1]}px, ${-pose.at[2]}px)`,
        }}
      >
        <PoseContext.Provider value={pose}>{children}</PoseContext.Provider>
      </div>
    </AbsoluteFill>
  );
}

/**
 * Place a thing in the world, centred on its point. It fades with depth.
 * There is no depth-of-field blur: a blur that switches on and off from one
 * frame to the next makes nearly still text flicker.
 */
export function At({
  p: local,
  rotate = [0, 0, 0],
  scale = 1,
  opacity = 1,
  far,
  cull = 0,
  edge = true,
  extent = 200,
  children,
  style,
}: {
  p: Vec;
  rotate?: Vec;
  scale?: number;
  opacity?: number;
  far?: number;
  /** For small things: skip them when they are this far outside the frame. */
  cull?: number;
  /** Fade out near the frame edge; off for the dust, which may be cut. */
  edge?: boolean;
  /** Half the thing's width in world pixels, so a wide card fades before its side is cut. */
  extent?: number;
  children: ReactNode;
  style?: CSSProperties;
}) {
  const pose = usePose();
  const place = useContext(PlaceContext);
  const world = toWorld(place, local);
  const [vx, vy, depth] = viewOf(pose, world);
  if (cull > 0) {
    const k = LENS / Math.max(1, depth);
    if (Math.abs(vx * k) > W / 2 + cull || Math.abs(vy * k) > H / 2 + cull) return null;
  }
  const seen = fog(depth, far) * opacity * (edge ? inFrame(pose, world, extent) : 1);
  if (seen < 0.005) return null;
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        // The world has no width; without this a thing would shrink to its narrowest wrap.
        width: "max-content",
        transformStyle: "preserve-3d",
        transform: `translate3d(${world[0]}px, ${world[1]}px, ${world[2]}px) rotateY(${rotate[1] - place.yaw}deg) rotateX(${rotate[0]}deg) rotateZ(${rotate[2]}deg) scale(${scale}) translate(-50%, -50%)`,
        opacity: seen,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/** A hairline between two world points. */
export function Line({
  from: start,
  to: end,
  color,
  width = 2,
  progress = 1,
  opacity = 1,
  edge = true,
}: {
  from: Vec;
  to: Vec;
  color: string;
  width?: number;
  progress?: number;
  opacity?: number;
  /** Fade with whichever end leaves the frame first, so no line leads off screen. */
  edge?: boolean;
}) {
  const pose = usePose();
  const place = useContext(PlaceContext);
  const from = toWorld(place, start);
  const to = toWorld(place, end);
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const dz = to[2] - from[2];
  const length = Math.hypot(dx, dy, dz);
  // A long line stays while either end is in view, even after the camera passes its middle.
  const seen =
    Math.max(fog(depthOf(pose, from)), fog(depthOf(pose, to))) *
    opacity *
    (edge ? Math.min(inFrame(pose, from), inFrame(pose, to)) : 1);
  if (length === 0 || progress <= 0 || seen < 0.005) return null;
  const tilt = Math.asin(dy / length);
  const swing = Math.atan2(-dz, dx);
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: length * progress,
        height: width,
        marginTop: -width / 2,
        background: color,
        opacity: seen,
        transformOrigin: "0 50%",
        transform: `translate3d(${from[0]}px, ${from[1]}px, ${from[2]}px) rotateY(${swing}rad) rotateZ(${tilt}rad)`,
      }}
    />
  );
}
