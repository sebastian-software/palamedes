import { AbsoluteFill, useCurrentFrame } from "remotion";

import { C } from "../brand";
import { BAR } from "../timeline";
import { arrive, Display, sceneFade } from "../ui";
import { at } from "./timeline";

/*
 * Bars 41–42: "Clear, complete, and fast. For once, you get to pick all
 * three." Each word arrives as it is spoken; the answer lands with the full
 * chord on the second downbeat.
 */
const WORDS = [
  { text: "Clear,", cue: at(0.2) },
  { text: "complete,", cue: at(0.95) },
  { text: "and fast.", cue: at(1.7) },
];
const PICK = at(3.9);

export function FilmClaim() {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill
      style={{
        background: C.mist,
        alignItems: "center",
        justifyContent: "center",
        opacity: sceneFade(frame, BAR * 2),
      }}
    >
      <div style={{ display: "flex", gap: 40 }}>
        {WORDS.map((word) => (
          <Display key={word.text} size={120} style={arrive(frame, word.cue - 3, 10, 26)}>
            {word.text}
          </Display>
        ))}
      </div>
      <Display
        size={140}
        style={{ marginTop: 34, color: C.bronze, ...arrive(frame, PICK - 4, 12, 30) }}
      >
        Pick all three.
      </Display>
    </AbsoluteFill>
  );
}
