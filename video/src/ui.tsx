import { Children, type CSSProperties, type ReactNode, useEffect, useMemo } from "react";
import { continueRender, delayRender, Easing, interpolate, staticFile } from "remotion";

import { C, FONT } from "./brand";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/** 0 → 1 between two frames, eased out. */
export function ease(frame: number, start: number, duration = 14): number {
  return interpolate(frame, [start, start + duration], [0, 1], {
    ...clamp,
    easing: Easing.out(Easing.cubic),
  });
}

/** Opacity and a short rise for things that arrive. */
export function arrive(frame: number, start: number, duration = 14, distance = 22): CSSProperties {
  const t = ease(frame, start, duration);
  return { opacity: t, transform: `translateY(${(1 - t) * distance}px)` };
}

/** Fade a whole scene in at its start and out before its end. */
export function sceneFade(frame: number, length: number, edge = 9): number {
  return interpolate(frame, [0, edge, length - edge, length], [0, 1, 1, 0], clamp);
}

/** Load the display face once; rendering waits until the font is ready. */
export function useBrandFonts() {
  const handle = useMemo(() => delayRender("Cinzel Hellenic"), []);
  useEffect(() => {
    const face = new FontFace(
      "Cinzel Hellenic",
      `url(${staticFile("fonts/CinzelHellenic-Regular.woff2")})`,
    );
    face
      .load()
      .then((loaded) => {
        document.fonts.add(loaded);
        return document.fonts.ready;
      })
      .then(() => continueRender(handle))
      .catch(() => continueRender(handle));
  }, [handle]);
}

export function Kicker({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <p
      style={{
        display: "flex",
        alignItems: "center",
        gap: 18,
        margin: 0,
        fontFamily: FONT.mono,
        fontSize: 22,
        letterSpacing: "0.16em",
        textTransform: "uppercase",
        color: C.bronze,
        ...style,
      }}
    >
      <span style={{ width: 52, height: 2, background: C.bronze }} />
      {children}
    </p>
  );
}

export function Display({
  children,
  size = 96,
  style,
}: {
  children: ReactNode;
  size?: number;
  style?: CSSProperties;
}) {
  return (
    <h1
      style={{
        margin: 0,
        fontFamily: FONT.display,
        fontWeight: 400,
        fontSize: size,
        lineHeight: 1.04,
        letterSpacing: "0.005em",
        color: C.ink,
        // No lone word on a second line: the browser evens the lines out.
        textWrap: "balance",
        ...style,
      }}
    >
      {children}
    </h1>
  );
}

/** A light code listing: ink on the listing ground, bronze for marked parts. */
export function Listing({
  label,
  lines,
  tone = "code",
  style,
  fontSize = 25,
}: {
  label: string;
  lines: ReactNode[];
  tone?: "code" | "file";
  style?: CSSProperties;
  fontSize?: number;
}) {
  return (
    <div
      style={{
        border: `1.5px solid ${C.hair}`,
        background: tone === "code" ? C.listing : C.paper,
        ...style,
      }}
    >
      <p
        style={{
          margin: 0,
          padding: "16px 26px",
          borderBottom: `1.5px solid ${C.hair}`,
          background: C.paper,
          fontFamily: FONT.mono,
          fontSize: 19,
          letterSpacing: "0.02em",
          color: C.slate,
        }}
      >
        {label}
      </p>
      <pre
        style={{
          margin: 0,
          padding: "22px 26px",
          fontFamily: FONT.mono,
          fontSize,
          lineHeight: 1.7,
          color: C.ink,
          whiteSpace: "pre",
        }}
      >
        {/* Children.map keys the ordered, static lines by position. */}
        {Children.map(lines, (line) => (
          <span style={{ display: "block", minHeight: "1.7em" }}>{line}</span>
        ))}
      </pre>
    </div>
  );
}

export const Mark = ({ children }: { children: ReactNode }) => (
  <span style={{ color: C.bronze, fontWeight: 700 }}>{children}</span>
);

export const Dim = ({ children }: { children: ReactNode }) => (
  <span style={{ color: C.gray }}>{children}</span>
);

export const Tag = ({ children }: { children: ReactNode }) => (
  <span style={{ color: C.slate }}>{children}</span>
);

/** The release this cut presents; the film's v2.0 badge and end card read it. */
export const RELEASE = "v2.0";

/** A bronze release badge, sized by its type. */
export function VersionBadge({ size = 22, style }: { size?: number; style?: CSSProperties }) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: `${size * 0.28}px ${size * 0.62}px`,
        border: `2px solid ${C.bronze}`,
        borderRadius: 999,
        background: C.paper,
        fontFamily: FONT.mono,
        fontSize: size,
        fontWeight: 700,
        letterSpacing: "0.08em",
        lineHeight: 1,
        textTransform: "none",
        color: C.bronze,
        ...style,
      }}
    >
      {RELEASE}
    </span>
  );
}
