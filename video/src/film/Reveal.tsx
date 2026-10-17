import { AbsoluteFill, Img, interpolate, spring, staticFile, useCurrentFrame } from "remotion";

import { HERO_MESSAGE, HERO_MORPH } from "../../../site/app/data/journey";
import { C, FONT } from "../brand";
import { ramp } from "../flight/motion";
import { BAR, BEAT, FPS } from "../timeline";
import { Revealed } from "../kinetic";
import { arrive, Display, ease, sceneFade } from "../ui";
import { at } from "./timeline";

/*
 * Bars 9–13: "That's exactly why we built Palamedes. You just write your
 * sentences… Your translators bring the languages, and Palamedes takes care
 * of everything in between." The emblem settles, then the division of labour
 * is set out in three rows; Palamedes is the rail between them.
 */
const CUE = {
  rows: at(3.1),
  translators: at(6.2),
  visitors: at(7.5),
  between: at(8.3),
};
const TRANSLATED = HERO_MORPH.filter((entry) => ["de", "es", "ja"].includes(entry.locale));
const ROW_Y = [250, 520, 790] as const;
const STEP = BEAT * 1.25;

export function Reveal() {
  const frame = useCurrentFrame();
  const emblem = spring({ frame, fps: FPS, config: { damping: 18, mass: 0.9 } });
  const away = ramp(frame, CUE.rows - 14, CUE.rows + 6);
  const rail = ramp(frame, CUE.between, CUE.between + 26);
  const morph = Math.max(0, frame - CUE.visitors);
  const index = Math.min(HERO_MORPH.length - 1, Math.floor(morph / STEP));
  const entry = HERO_MORPH[index] ?? HERO_MORPH[0];
  const previous = index > 0 ? HERO_MORPH[index - 1] : undefined;
  const leave = interpolate(morph - index * STEP, [0, 9], [0, 1], { extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ background: C.mist, opacity: sceneFade(frame, BAR * 5) }}>
      {/* the emblem and the name, before the rows take over */}
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", opacity: 1 - away }}>
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
            fontSize: 48,
            letterSpacing: "0.28em",
            color: C.ink,
            ...arrive(frame, 10, 16, 14),
          }}
        >
          PALAMEDES
        </p>
      </AbsoluteFill>

      {/* the rows: who does what */}
      <div style={{ position: "absolute", left: 300, top: 0, opacity: away }}>
        <div
          style={{ position: "absolute", top: ROW_Y[0], width: 1400, ...arrive(frame, CUE.rows) }}
        >
          <p
            style={{
              margin: 0,
              fontFamily: FONT.sans,
              fontSize: 30,
              fontWeight: 600,
              color: C.slate,
            }}
          >
            You write
          </p>
          <p
            style={{
              display: "inline-block",
              margin: "24px 0 0",
              padding: "18px 28px",
              border: `1.5px solid ${C.hair}`,
              background: C.listing,
              fontFamily: FONT.mono,
              fontSize: 36,
              color: C.ink,
            }}
          >
            <span style={{ color: C.slate }}>{"<Trans>"}</span>
            <span style={{ color: C.bronze, fontWeight: 700 }}>{HERO_MESSAGE}</span>
            <span style={{ color: C.slate }}>{"</Trans>"}</span>
          </p>
        </div>

        <div style={{ position: "absolute", top: ROW_Y[1], width: 1400 }}>
          <p
            style={{
              margin: 0,
              fontFamily: FONT.sans,
              fontSize: 30,
              fontWeight: 600,
              color: C.slate,
              ...arrive(frame, CUE.translators),
            }}
          >
            Your translators add
          </p>
          <div style={{ display: "flex", gap: 22, marginTop: 24 }}>
            {TRANSLATED.map((item, position) => (
              <p
                key={item.locale}
                lang={item.locale}
                style={{
                  margin: 0,
                  padding: "16px 24px",
                  border: `1.5px solid ${C.hair}`,
                  background: C.paper,
                  fontFamily: FONT.sans,
                  fontSize: 30,
                  whiteSpace: "nowrap",
                  color: C.ink,
                  ...arrive(frame, CUE.translators + 4 + position * 5),
                }}
              >
                <span
                  style={{
                    marginRight: 16,
                    fontFamily: FONT.mono,
                    fontSize: 20,
                    color: C.slate,
                  }}
                >
                  {item.locale}.po
                </span>
                {item.text}
              </p>
            ))}
          </div>
        </div>

        <div style={{ position: "absolute", top: ROW_Y[2], width: 1400 }}>
          <p
            style={{
              margin: 0,
              fontFamily: FONT.sans,
              fontSize: 30,
              fontWeight: 600,
              color: C.slate,
              ...arrive(frame, CUE.visitors),
            }}
          >
            Your visitors read
          </p>
          <div style={{ display: "flex", alignItems: "baseline", gap: 40, marginTop: 20 }}>
            <span
              style={{
                width: 70,
                fontFamily: FONT.mono,
                fontSize: 28,
                letterSpacing: "0.14em",
                color: C.bronze,
                textTransform: "uppercase",
                opacity: ease(frame, CUE.visitors, 10),
              }}
            >
              {previous && morph - index * STEP < 9 ? previous.locale : entry.locale}
            </span>
            <span
              style={{ position: "relative", display: "inline-block", minWidth: 1200, height: 96 }}
            >
              {previous && morph - index * STEP < 10 ? (
                <span
                  lang={previous.locale}
                  dir={previous.dir}
                  style={{
                    position: "absolute",
                    left: 0,
                    top: 0,
                    fontFamily: FONT.sans,
                    fontSize: 76,
                    fontWeight: 500,
                    color: C.ink,
                    opacity: 1 - leave,
                    transform: `translateY(${-18 * leave}px)`,
                    filter: `blur(${(6 * leave).toFixed(2)}px)`,
                  }}
                >
                  {previous.text}
                </span>
              ) : null}
              {frame >= CUE.visitors ? (
                <span
                  lang={entry.locale}
                  dir={entry.dir}
                  style={{
                    position: "absolute",
                    left: 0,
                    top: 0,
                    fontFamily: FONT.sans,
                    fontSize: 76,
                    fontWeight: 500,
                    color: C.ink,
                    whiteSpace: "nowrap",
                  }}
                >
                  <Revealed text={entry.text} frame={morph} at={index * STEP + 2} blur={8} />
                </span>
              ) : null}
            </span>
          </div>
        </div>
      </div>

      {/* Palamedes: everything in between */}
      <div style={{ position: "absolute", left: 200, top: ROW_Y[0] + 10, opacity: away }}>
        <span
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: 4,
            height: (ROW_Y[2] - ROW_Y[0] + 90) * rail,
            background: C.bronze,
          }}
        />
        {[0, 1, 2].map((row) => (
          <span
            key={row}
            style={{
              position: "absolute",
              left: -9,
              top: (ROW_Y[row] ?? 0) - ROW_Y[0] + 4,
              width: 22,
              height: 22,
              border: `3px solid ${C.bronze}`,
              background: C.mist,
              transform: "rotate(45deg)",
              opacity: rail > row / 2.2 ? 1 : 0,
            }}
          />
        ))}
      </div>
      <div
        style={{
          position: "absolute",
          right: 140,
          top: 120,
          display: "flex",
          alignItems: "center",
          gap: 18,
          ...arrive(frame, CUE.between + 10),
        }}
      >
        <Img src={staticFile("logo.svg")} style={{ width: 64, height: 64 }} />
        <div>
          <Display size={40}>Palamedes</Display>
          <p style={{ margin: "4px 0 0", fontFamily: FONT.sans, fontSize: 24, color: C.slate }}>
            takes care of everything in between
          </p>
        </div>
      </div>
    </AbsoluteFill>
  );
}
