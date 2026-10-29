import type { CSSProperties, ReactNode } from "react";
import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from "remotion";

import { C, FONT } from "../brand";
import { steady } from "../kinetic";

/*
 * The launch cut's motion vocabulary: things snap into place in a few frames
 * and then hold, every scene drifts in a slow push so no frame stands still,
 * and each scene enters with a short scale snap on its downbeat.
 */
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/** 0 → 1 in a few frames, hard out: a snap rather than a glide. */
export function snap(frame: number, at: number, frames = 4): number {
  return interpolate(frame, [at, at + frames], [0, 1], {
    ...clamp,
    easing: Easing.out(Easing.exp),
  });
}

/** Arrive by snapping in from a little larger and offset. */
export function snapIn(
  frame: number,
  at: number,
  from: { x?: number; y?: number; s?: number } = {},
): CSSProperties {
  const t = snap(frame, at);
  const { x = 0, y = 24, s = 1.08 } = from;
  return {
    opacity: t,
    transform: `translate(${(1 - t) * x}px, ${(1 - t) * y}px) scale(${1 + (s - 1) * (1 - t)})`,
  };
}

/** Leave by snapping away: shrink and fade. */
export function snapOut(frame: number, at: number, frames = 4): CSSProperties {
  const t = snap(frame, at, frames);
  return { opacity: 1 - t, transform: `scale(${1 - 0.12 * t})` };
}

/** A whole scene: ground colour, entry snap, and a slow push across its length. */
export function Stage({
  length,
  ground,
  push = 0.035,
  children,
  style,
}: {
  length: number;
  ground: string;
  push?: number;
  children: ReactNode;
  style?: CSSProperties;
}) {
  const frame = useCurrentFrame();
  const enter = snap(frame, 0, 5);
  const drift = 1 + push * (frame / length);
  return (
    <AbsoluteFill style={{ background: ground, overflow: "hidden", ...steady }}>
      <AbsoluteFill
        style={{
          transform: `scale(${drift * (1 + 0.05 * (1 - enter))})`,
          opacity: 0.35 + 0.65 * enter,
          ...style,
        }}
      >
        {children}
      </AbsoluteFill>
    </AbsoluteFill>
  );
}

/** Mono type at film size. */
export function Mono({
  children,
  size = 48,
  color = C.ink,
  style,
}: {
  children: ReactNode;
  size?: number;
  color?: string;
  style?: CSSProperties;
}) {
  return (
    <span
      style={{
        fontFamily: FONT.mono,
        fontSize: size,
        lineHeight: 1.35,
        color,
        whiteSpace: "pre",
        ...style,
      }}
    >
      {children}
    </span>
  );
}

/** A small mono label in slate, for file names and scope lines. */
export function Label({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <span
      style={{
        fontFamily: FONT.mono,
        fontSize: 24,
        letterSpacing: "0.04em",
        color: C.slate,
        ...style,
      }}
    >
      {children}
    </span>
  );
}

/** A flat card in the listing style: a file name over its content. */
export function FileCard({
  name,
  children,
  style,
  right,
}: {
  name: ReactNode;
  children: ReactNode;
  style?: CSSProperties;
  right?: ReactNode;
}) {
  return (
    <div style={{ border: `2px solid ${C.hair}`, background: C.listing, ...style }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 24,
          padding: "14px 24px",
          borderBottom: `2px solid ${C.hair}`,
          background: C.paper,
        }}
      >
        <Label>{name}</Label>
        {right}
      </div>
      <div style={{ padding: "18px 24px" }}>{children}</div>
    </div>
  );
}

/** Typed text: the first part of `text` after `start`, at `cps` characters per second. */
export function typedAt(text: string, frame: number, start: number, frames: number): string {
  const t = interpolate(frame, [start, start + frames], [0, 1], clamp);
  return text.slice(0, Math.round(t * text.length));
}

/** A number that counts to `to` between two frames. */
export function count(
  frame: number,
  start: number,
  frames: number,
  from: number,
  to: number,
): number {
  const t = interpolate(frame, [start, start + frames], [0, 1], {
    ...clamp,
    easing: Easing.out(Easing.cubic),
  });
  return Math.round(from + (to - from) * t);
}

/** A blinking caret for text being typed. */
export function Caret({ frame, color = C.bronze }: { frame: number; color?: string }) {
  return (
    <span
      style={{
        display: "inline-block",
        width: "0.08em",
        height: "1.05em",
        marginLeft: "0.06em",
        verticalAlign: "-0.15em",
        background: color,
        opacity: Math.floor(frame / 8) % 2 ? 0.2 : 1,
      }}
    />
  );
}

export const Plus = ({ children }: { children: ReactNode }) => (
  <span style={{ color: C.bronze, fontWeight: 700 }}>{children}</span>
);
