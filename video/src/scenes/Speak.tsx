import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";

import { HERO_MESSAGE, HERO_MORPH } from "../../../site/app/data/journey";
import { C, FONT } from "../brand";
import { BAR, BEAT } from "../timeline";
import { arrive, Kicker, sceneFade } from "../ui";

/*
 * Bars 7–8: the promise made visible. The one sentence in the code stays put
 * while the rendered sentence steps through six languages, one per beat and a
 * quarter, the same words the homepage hero cycles through.
 */
const STEP = BEAT * 1.25;

export function Speak() {
  const frame = useCurrentFrame();
  const index = Math.min(HERO_MORPH.length - 1, Math.floor(frame / STEP));
  const local = frame - index * STEP;
  const entry = HERO_MORPH[index] ?? HERO_MORPH[0];
  const settle = interpolate(local, [0, 9], [0, 1], { extrapolateRight: "clamp" });

  return (
    <AbsoluteFill
      style={{
        background: C.mist,
        padding: "150px 160px",
        opacity: sceneFade(frame, BAR * 2),
      }}
    >
      <Kicker style={arrive(frame, 0)}>You write</Kicker>
      <p
        style={{
          margin: "28px 0 0",
          display: "inline-block",
          alignSelf: "flex-start",
          padding: "22px 32px",
          border: `1.5px solid ${C.hair}`,
          background: C.listing,
          fontFamily: FONT.mono,
          fontSize: 38,
          color: C.ink,
          ...arrive(frame, 2),
        }}
      >
        <span style={{ color: C.slate }}>{"<Trans>"}</span>
        <span style={{ color: C.bronze, fontWeight: 700 }}>{HERO_MESSAGE}</span>
        <span style={{ color: C.slate }}>{"</Trans>"}</span>
      </p>

      <Kicker style={{ marginTop: 110, ...arrive(frame, 8) }}>Your visitors read</Kicker>
      <div style={{ display: "flex", alignItems: "baseline", gap: 44, marginTop: 34 }}>
        <span
          style={{
            width: 90,
            fontFamily: FONT.mono,
            fontSize: 30,
            letterSpacing: "0.14em",
            color: C.bronze,
            textTransform: "uppercase",
          }}
        >
          {entry.locale}
        </span>
        <span
          lang={entry.locale}
          dir={entry.dir}
          style={{
            fontFamily: FONT.sans,
            fontSize: 92,
            fontWeight: 500,
            color: C.ink,
            opacity: settle,
            transform: `translateY(${(1 - settle) * 18}px)`,
            filter: `blur(${(1 - settle) * 4}px)`,
          }}
        >
          {entry.text}
        </span>
      </div>
      <div style={{ display: "flex", gap: 12, marginTop: 56 }}>
        {HERO_MORPH.map((item, position) => (
          <span
            key={item.locale}
            style={{
              width: 64,
              height: 5,
              background: position <= index ? C.bronze : C.mistDeep,
            }}
          />
        ))}
      </div>
    </AbsoluteFill>
  );
}
