import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame } from "remotion";

import { C, FONT } from "../brand";
import { BAR } from "../timeline";
import { arrive, Display } from "../ui";

/** Scene frames for the domain and the licence line; defaults follow the promo. */
export interface EndCues {
  domain: number;
  note: number;
  bars: number;
}

export const PROMO_END: EndCues = { domain: 20, note: 24, bars: 2 };

/* The end card. It holds still and fades only at the very end. */
export function End({ cues = PROMO_END }: { cues?: EndCues }) {
  const frame = useCurrentFrame();
  const out = interpolate(frame, [BAR * cues.bars - 18, BAR * cues.bars], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{ background: C.mist, alignItems: "center", justifyContent: "center", opacity: out }}
    >
      <Img
        src={staticFile("logo.svg")}
        style={{ width: 190, height: 190, ...arrive(frame, 0, 16, 10) }}
      />
      <p
        style={{
          margin: "30px 0 0",
          fontFamily: FONT.display,
          fontSize: 46,
          letterSpacing: "0.28em",
          color: C.ink,
          ...arrive(frame, 6, 14, 12),
        }}
      >
        PALAMEDES
      </p>
      <Display size={72} style={{ marginTop: 40, ...arrive(frame, 12) }}>
        Just write <span style={{ color: C.bronze }}>the sentence.</span>
      </Display>
      <p
        style={{
          margin: "56px 0 0",
          fontFamily: FONT.mono,
          fontSize: 36,
          color: C.ink,
          ...arrive(frame, cues.domain),
        }}
      >
        palamedes.dev
      </p>
      <p
        style={{
          margin: "16px 0 0",
          fontFamily: FONT.sans,
          fontSize: 24,
          color: C.slate,
          ...arrive(frame, cues.note),
        }}
      >
        Open source · MIT OR Apache-2.0 · React, Solid &amp; TypeScript
      </p>
    </AbsoluteFill>
  );
}
