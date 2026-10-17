import type { ReactNode } from "react";
import { Easing } from "remotion";

import { C } from "../brand";
import { ease } from "../ui";
import { arc, mix, ramp, type Point } from "./motion";
import { lineHeight, Token } from "./stage";

/*
 * Moving text the way drag and drop once did: the box is grabbed, collapses
 * into a small spark, the spark travels, and the box unfolds again where it
 * lands. Nothing is dragged across the screen at full size, and nothing
 * trails behind it.
 */
const ADVANCE = 1233 / 2048;
const GRAB = 10;
const COLLAPSE = 9;
const EXPAND = 10;

export interface TextBox {
  /** Top-left corner of the text. */
  at: Point;
  fontSize: number;
  /** The text lines, used to size the box. */
  lines: readonly string[];
}

export function centre(box: TextBox): Point {
  const width = Math.max(0, ...box.lines.map((line) => line.length)) * box.fontSize * ADVANCE;
  const height = box.lines.length * lineHeight(box.fontSize);
  return [box.at[0] + width / 2, box.at[1] + height / 2];
}

/** A four-point spark with an inner glint turning the other way. */
export function Spark({
  at,
  size = 34,
  turn = 0,
  opacity = 1,
}: {
  at: Point;
  size?: number;
  turn?: number;
  opacity?: number;
}) {
  const star =
    "M 0 -1 C 0.12 -0.12 0.12 -0.12 1 0 C 0.12 0.12 0.12 0.12 0 1 C -0.12 0.12 -0.12 0.12 -1 0 C -0.12 -0.12 -0.12 -0.12 0 -1 Z";
  return (
    <svg
      width={size}
      height={size}
      viewBox="-1 -1 2 2"
      style={{
        position: "absolute",
        left: at[0] - size / 2,
        top: at[1] - size / 2,
        overflow: "visible",
        opacity,
      }}
    >
      <path d={star} fill={C.bronze} transform={`rotate(${turn})`} />
      <path d={star} fill={C.gold} transform={`rotate(${45 - turn * 1.6}) scale(0.55)`} />
    </svg>
  );
}

export function SparkFlight({
  frame,
  from,
  to,
  start,
  end,
  lift = 240,
  grab = true,
  drop = true,
  color,
  render,
}: {
  frame: number;
  from: TextBox;
  to: TextBox;
  start: number;
  end: number;
  lift?: number;
  /** Collapse a framed box at the origin; otherwise begin as a spark. */
  grab?: boolean;
  /** Unfold a framed box at the destination; otherwise end as a spark. */
  drop?: boolean;
  color?: string;
  render: (side: "from" | "to") => ReactNode;
}) {
  if (frame < start - GRAB || frame > end + 10) return null;
  const a = centre(from);
  const b = centre(to);
  const departs = grab ? start + COLLAPSE : start;
  const arrives = drop ? end - EXPAND : end;
  const t = ramp(frame, departs, arrives, Easing.inOut(Easing.cubic));
  const at = arc(a, b, t, lift);
  const turn = (frame - start) * 9;
  const pulse = 1 + Math.sin((frame - start) * 0.5) * 0.12;

  // Grab: the frame appears, then the box folds into the spark.
  const held = grab ? ease(frame, start - GRAB, GRAB) : 0;
  const fold = grab ? ramp(frame, start, start + COLLAPSE, Easing.in(Easing.cubic)) : 1;
  // Drop: the box unfolds from the spark, then the frame melts away.
  const unfold = drop ? ramp(frame, end - EXPAND, end, Easing.out(Easing.back(1.4))) : 0;
  const melt = drop ? ease(frame, end, 8) : 0;

  const sparkIn = grab
    ? ramp(frame, start + COLLAPSE * 0.4, start + COLLAPSE)
    : ease(frame, start, 6);
  const sparkOut = drop
    ? 1 - ramp(frame, end - EXPAND, end - EXPAND * 0.4)
    : 1 - ease(frame, end, 6);
  const spark = Math.min(sparkIn, sparkOut);

  return (
    <>
      {grab && frame < start + COLLAPSE && (
        <Token
          at={from.at}
          fontSize={from.fontSize}
          frame={held}
          scale={mix(1 + 0.05 * held, 0.02, fold)}
          opacity={1 - ramp(frame, start + COLLAPSE * 0.6, start + COLLAPSE)}
          color={color}
        >
          <span style={{ opacity: 1 - fold }}>{render("from")}</span>
        </Token>
      )}
      {spark > 0 && <Spark at={at} turn={turn} size={54 * pulse} opacity={spark} />}
      {drop && frame >= end - EXPAND && (
        <Token
          at={to.at}
          fontSize={to.fontSize}
          frame={1 - melt}
          scale={mix(0.02, 1, unfold)}
          color={color}
        >
          <span style={{ opacity: ramp(frame, end - EXPAND * 0.5, end) }}>{render("to")}</span>
        </Token>
      )}
    </>
  );
}
