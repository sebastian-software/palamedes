import { AbsoluteFill, Img, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";

import { C, FONT } from "../brand";
import { BAR } from "../timeline";
import { arrive, Display, sceneFade } from "../ui";

/*
 * Bars 5–6: the reveal. The emblem settles, the name is set like an
 * inscription, and the promise lands on the second downbeat.
 */
export function Meet() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const emblem = spring({ frame, fps, config: { damping: 18, mass: 0.9 } });

  return (
    <AbsoluteFill
      style={{
        background: C.mist,
        alignItems: "center",
        justifyContent: "center",
        opacity: sceneFade(frame, BAR * 2),
      }}
    >
      <Img
        src={staticFile("logo.svg")}
        style={{
          width: 230,
          height: 230,
          opacity: emblem,
          transform: `scale(${0.86 + 0.14 * emblem})`,
        }}
      />
      <p
        style={{
          margin: "34px 0 0",
          fontFamily: FONT.display,
          fontSize: 44,
          letterSpacing: "0.28em",
          color: C.ink,
          ...arrive(frame, 10, 16, 14),
        }}
      >
        PALAMEDES
      </p>
      <div style={{ marginTop: 70, textAlign: "center", ...arrive(frame, BAR, 16) }}>
        <Display size={104}>
          Just write <span style={{ color: C.bronze }}>the sentence.</span>
        </Display>
      </div>
    </AbsoluteFill>
  );
}
