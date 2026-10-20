import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame } from "remotion";

import { C, FONT } from "../brand";
import { BAR } from "../timeline";
import { Revealed } from "../kinetic";
import { arrive, Display, ease } from "../ui";

/** Scene frames for the domain and the license line. */
export interface EndCues {
  domain: number;
  note: number;
  bars: number;
  /** When the company band arrives; leave it out for a card without one. */
  company?: number;
}

/*
 * The end card holds still and fades only at the very end. The company band
 * follows the same pattern as dalo.sh: who makes Palamedes, and who to talk
 * to when you want help with it.
 */
export function End({ cues }: { cues: EndCues }) {
  const frame = useCurrentFrame();
  const band = cues.company === undefined ? 0 : ease(frame, cues.company, 20);
  const out = interpolate(frame, [BAR * cues.bars - 18, BAR * cues.bars], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ background: C.mist, opacity: out }}>
      <AbsoluteFill
        style={{
          alignItems: "center",
          justifyContent: "center",
          transform: `translateY(${-110 * band}px)`,
        }}
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
        <Display size={64} style={{ marginTop: 40 }}>
          <Revealed text="Just write" frame={frame} at={12} />
          <span style={{ color: C.bronze }}>
            <Revealed text="the sentence." frame={frame} at={18} />
          </span>
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
          Open source · MIT OR Apache-2.0
        </p>
      </AbsoluteFill>
      {cues.company === undefined ? null : <CompanyBand frame={frame} at={cues.company} />}
    </AbsoluteFill>
  );
}

function CompanyBand({ frame, at }: { frame: number; at: number }) {
  const text = { margin: 0, fontFamily: FONT.sans, fontSize: 24, color: C.slate } as const;
  return (
    <div
      style={{
        position: "absolute",
        left: 260,
        right: 260,
        bottom: 96,
        display: "grid",
        gridTemplateColumns: "1fr 1.6fr",
        gap: 80,
        paddingTop: 40,
        borderTop: `1.5px solid ${C.hair}`,
        ...arrive(frame, at, 18, 24),
      }}
    >
      <div>
        <p style={text}>Made by</p>
        <Img
          src={staticFile("company/sebastian-software.svg")}
          style={{ display: "block", width: 300, marginTop: 14 }}
        />
        <p style={{ ...text, marginTop: 16 }}>oss.sebastian-software.com</p>
      </div>
      <div style={arrive(frame, at + 8, 18, 24)}>
        {/* No label here: the space keeps both logos on one line. */}
        <p style={{ ...text, visibility: "hidden" }}>Made by</p>
        <Img
          src={staticFile("company/sebastian-consulting.svg")}
          style={{ display: "block", width: 300, marginTop: 14 }}
        />
        <p style={{ ...text, marginTop: 16 }}>
          TypeScript, React, Rust, and agentic software development.
        </p>
        <p style={{ ...text, marginTop: 6 }}>sebastian-consulting.com</p>
      </div>
    </div>
  );
}
