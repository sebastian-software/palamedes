import { AbsoluteFill, useCurrentFrame } from "remotion";

import { C } from "../brand";
import { BAR } from "../timeline";
import { Revealed } from "../kinetic";
import { Display, sceneFade } from "../ui";

/*
 * "The fastest i18n toolchain. Complete from code to screen, and proven in
 * eighteen integrations." One measured superlative, then two statements that
 * need no rival to hold: the workflow the journey just showed, and the count
 * of integrations on the homepage stripe, each with a guide and an example.
 */
export interface ClaimCues {
  fastest: number;
  complete: number;
  proven: number;
  bars: number;
}

export function FilmClaim({ cues }: { cues: ClaimCues }) {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill
      style={{
        background: C.mist,
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        opacity: sceneFade(frame, BAR * cues.bars),
      }}
    >
      <Display size={108}>
        <Revealed text="The fastest i18n toolchain." frame={frame} at={cues.fastest - 4} />
      </Display>
      <Display size={64} style={{ marginTop: 48 }}>
        <Revealed text="Complete from code to screen." frame={frame} at={cues.complete - 4} />
      </Display>
      <Display size={64} style={{ marginTop: 18, color: C.bronze }}>
        <Revealed
          text="Proven in 18 integrations."
          frame={frame}
          at={cues.proven - 5}
          unit="character"
          stagger={1}
        />
      </Display>
    </AbsoluteFill>
  );
}
