import { AbsoluteFill, useCurrentFrame } from "remotion";

import { C } from "../brand";
import { BAR, BEAT } from "../timeline";
import { arrive, Display, sceneFade } from "../ui";

/*
 * Bars 20–21: the design goal. Each word arrives when the voice says it; the
 * frames come from the cue sheet (props), defaulting to one word per beat and
 * the answer on the next downbeat.
 */
const WORDS = ["Clear.", "Complete.", "Fast."];

export interface ClaimTiming {
  /** Scene frames at which "Clear.", "Complete." and "Fast." are spoken. */
  words: [number, number, number];
  /** Scene frame at which "Pick three." is spoken. */
  pick: number;
}

export const DEFAULT_CLAIM: ClaimTiming = {
  words: [4, Math.round(BEAT), Math.round(BEAT * 2)],
  pick: Math.round(BAR),
};

export function Claim({ timing = DEFAULT_CLAIM }: { timing?: ClaimTiming }) {
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
      <div style={{ display: "flex", gap: 44 }}>
        {WORDS.map((word, index) => (
          <Display key={word} size={128} style={arrive(frame, timing.words[index] - 3, 10, 26)}>
            {word}
          </Display>
        ))}
      </div>
      <Display
        size={156}
        style={{ marginTop: 28, color: C.bronze, ...arrive(frame, timing.pick - 3, 12, 30) }}
      >
        Pick three.
      </Display>
    </AbsoluteFill>
  );
}
