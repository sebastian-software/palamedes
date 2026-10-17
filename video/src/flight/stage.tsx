import { Children, type CSSProperties, type ReactNode } from "react";

import { C, FONT } from "../brand";
import type { Point } from "./motion";
import { ease } from "../ui";

/*
 * World-space building blocks for the camera scenes: code windows whose text
 * positions can be computed exactly (so a flying token lands on its line),
 * the token itself, and titles that live beside the station they name.
 */
const HEAD = 56;
const PAD_Y = 24;
const PAD_X = 32;
const EDGE = 1.5;
/** Menlo's advance width per em. */
const ADVANCE = 1233 / 2048;

export interface WinBox {
  x: number;
  y: number;
  fontSize: number;
}

export const lineHeight = (fontSize: number) => fontSize * 1.7;

/** World position of the top-left corner of a character cell in a window. */
export function cell(win: WinBox, line: number, column: number): Point {
  return [
    win.x + EDGE + PAD_X + column * win.fontSize * ADVANCE,
    win.y + EDGE + HEAD + PAD_Y + line * lineHeight(win.fontSize),
  ];
}

export function Win({
  box,
  width,
  label,
  lines,
  tone = "code",
  right,
  style,
}: {
  box: WinBox;
  width: number;
  label: ReactNode;
  lines: ReactNode[];
  tone?: "code" | "file";
  right?: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        position: "absolute",
        left: box.x,
        top: box.y,
        width,
        border: `${EDGE}px solid ${C.hair}`,
        background: tone === "code" ? C.listing : C.paper,
        ...style,
      }}
    >
      <div
        style={{
          boxSizing: "border-box",
          height: HEAD,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 20,
          padding: "0 26px",
          borderBottom: `${EDGE}px solid ${C.hair}`,
          background: C.paper,
          fontFamily: FONT.mono,
          fontSize: 17,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: C.slate,
          whiteSpace: "nowrap",
        }}
      >
        <span>{label}</span>
        {right}
      </div>
      <pre
        style={{
          margin: 0,
          padding: `${PAD_Y}px ${PAD_X}px`,
          fontFamily: FONT.mono,
          fontSize: box.fontSize,
          lineHeight: 1.7,
          color: C.ink,
          whiteSpace: "pre",
        }}
      >
        {/* Children.map keys the ordered, static lines by position. */}
        {Children.map(lines, (line) => (
          <span style={{ display: "block", height: lineHeight(box.fontSize) }}>{line}</span>
        ))}
      </pre>
    </div>
  );
}

/** The travelling sentence: text in a bronze frame that can melt into a line. */
export function Token({
  at,
  fontSize,
  children,
  frame = 1,
  scale = 1,
  rotate = 0,
  opacity = 1,
  color = C.ink,
}: {
  at: Point;
  fontSize: number;
  children: ReactNode;
  frame?: number;
  scale?: number;
  rotate?: number;
  opacity?: number;
  color?: string;
}) {
  return (
    <div
      style={{
        position: "absolute",
        left: at[0],
        top: at[1],
        transform: `rotate(${rotate}deg) scale(${scale})`,
        transformOrigin: "50% 50%",
        opacity,
        whiteSpace: "pre",
      }}
    >
      <span
        style={{
          position: "absolute",
          inset: `-${fontSize * 0.2}px -${fontSize * 0.35}px`,
          border: `2px solid ${C.bronze}`,
          background: C.paper,
          opacity: frame,
        }}
      />
      <span
        style={{
          position: "relative",
          display: "block",
          fontFamily: FONT.mono,
          fontSize,
          lineHeight: 1.7,
          color,
        }}
      >
        {children}
      </span>
    </div>
  );
}

/** A headline in the world, its words arriving one after another. */
export function Title({
  x,
  y,
  width,
  kicker,
  text,
  frame,
  at,
  out,
  size = 66,
}: {
  x: number;
  y: number;
  width: number;
  kicker: string;
  text: string;
  frame: number;
  at: number;
  out?: number;
  size?: number;
}) {
  const gone = out === undefined ? 0 : ease(frame, out, 10);
  const words = text.split(" ");
  return (
    <div style={{ position: "absolute", left: x, top: y, width, opacity: 1 - gone }}>
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
          opacity: ease(frame, at, 12),
        }}
      >
        <span style={{ width: 52 * ease(frame, at, 16), height: 2, background: C.bronze }} />
        {kicker}
      </p>
      <h2
        style={{
          margin: "20px 0 0",
          fontFamily: FONT.display,
          fontWeight: 400,
          fontSize: size,
          lineHeight: 1.08,
          color: C.ink,
        }}
      >
        {words.map((word, index) => {
          const t = ease(frame, at + 3 + index * 2, 12);
          return (
            <span
              // Words of a fixed headline never reorder.
              key={`${word}-${index.toString()}`}
              style={{
                display: "inline-block",
                marginRight: "0.28em",
                opacity: t,
                transform: `translateY(${(1 - t) * 26}px)`,
              }}
            >
              {word}
            </span>
          );
        })}
      </h2>
    </div>
  );
}

export const Ink = ({ children, color = C.bronze }: { children: ReactNode; color?: string }) => (
  <span style={{ color, fontWeight: 700 }}>{children}</span>
);

export const Gray = ({ children }: { children: ReactNode }) => (
  <span style={{ color: C.gray }}>{children}</span>
);
