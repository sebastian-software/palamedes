import { AbsoluteFill, useCurrentFrame } from "remotion";

import { C } from "../brand";
import { BAR } from "../timeline";
import { Revealed } from "../kinetic";
import { Display, sceneFade } from "../ui";
import { at } from "./timeline";

/*
 * Bars 44–45: "Clear, complete, and fast. For once, you get to pick all
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
      <Display size={108}>
        {WORDS.map((word) => (
          <Revealed key={word.text} text={word.text} frame={frame} at={word.cue - 4} />
        ))}
      </Display>
      <Display size={126} style={{ marginTop: 30, color: C.bronze }}>
        <Revealed text="Pick all three." frame={frame} at={PICK - 5} unit="character" stagger={1} />
      </Display>
    </AbsoluteFill>
  );
}
