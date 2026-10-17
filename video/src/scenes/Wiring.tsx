import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame } from "remotion";

import { C, FONT } from "../brand";
import { BAR, BEAT } from "../timeline";
import { arrive, Display, Kicker, sceneFade } from "../ui";

/*
 * Bars 15–16: framework integration. The marks of the first-party adapters
 * arrive on the beat, then a message travels the four moments every adapter
 * has to get right. Preview adapters keep their qualification on screen.
 */
interface IntegrationMark {
  file: string | null;
  name?: string;
  label: string | null;
  h: number;
}

const MARKS: readonly IntegrationMark[] = [
  { file: "nextjs", label: null, h: 30 },
  { file: "react-router", label: null, h: 36 },
  { file: "tanstack", label: "Start", h: 46 },
  { file: "solid", label: "Solid", h: 40 },
  // Waku's published SVG is drawn for dark surfaces; the ledger forbids
  // recolouring a mark, so the film names it instead.
  { file: null, name: "Waku", label: "preview", h: 32 },
  { file: "remix", label: "preview", h: 26 },
  { file: "vite", label: null, h: 30 },
];

const MOMENTS = [
  { where: "On the server", title: "The page is rendered" },
  { where: "On the wire", title: "HTML arrives translated" },
  { where: "In the browser", title: "The page comes alive" },
  { where: "Back on the server", title: "A server action replies" },
] as const;

export function Wiring() {
  const frame = useCurrentFrame();
  const travel = interpolate(frame, [BAR * 0.9, BAR * 1.85], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  // Stations sit 400px apart; the line joins their centres (27px in).
  const STATION = 400;
  const CENTRE = 27;

  return (
    <AbsoluteFill
      style={{ background: C.paper, padding: "110px 160px", opacity: sceneFade(frame, BAR * 2) }}
    >
      <Kicker style={arrive(frame, 0)}>Framework integration</Kicker>
      <Display size={70} style={{ marginTop: 26, maxWidth: 1500, ...arrive(frame, 3) }}>
        The wiring is already built — and tested as real apps.
      </Display>

      <div style={{ display: "flex", alignItems: "center", gap: 40, marginTop: 70, height: 70 }}>
        {MARKS.map((mark, index) => (
          <div
            key={mark.file ?? mark.name}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              ...arrive(frame, 8 + index * (BEAT / 2.5), 10),
            }}
          >
            {mark.file ? (
              <Img src={staticFile(`logos/${mark.file}.svg`)} style={{ height: mark.h }} />
            ) : (
              <span style={{ fontFamily: FONT.sans, fontSize: 34, fontWeight: 800, color: C.ink }}>
                {mark.name}
              </span>
            )}
            {mark.label ? (
              <span
                style={{
                  fontFamily: mark.label === "preview" ? FONT.mono : FONT.sans,
                  fontSize: mark.label === "preview" ? 16 : 26,
                  fontWeight: mark.label === "preview" ? 400 : 700,
                  letterSpacing: mark.label === "preview" ? "0.14em" : 0,
                  textTransform: mark.label === "preview" ? "uppercase" : "none",
                  color: mark.label === "preview" ? C.gray : C.ink,
                }}
              >
                {mark.label}
              </span>
            ) : null}
          </div>
        ))}
      </div>

      <div style={{ position: "relative", marginTop: 90, height: 260 }}>
        <span
          style={{
            position: "absolute",
            top: CENTRE - 1,
            left: CENTRE,
            width: STATION * 3,
            height: 2,
            background: "rgba(134, 96, 38, 0.45)",
          }}
        />
        <span
          style={{
            position: "absolute",
            top: CENTRE - 7,
            left: CENTRE - 7 + travel * STATION * 3,
            width: 14,
            height: 14,
            background: C.bronze,
            transform: "rotate(45deg)",
            opacity: travel > 0 && travel < 1 ? 1 : 0,
          }}
        />
        {MOMENTS.map((moment, index) => {
          const reached = travel >= index / 3 - 0.001;
          return (
            <div
              key={moment.title}
              style={{ position: "absolute", left: index * STATION, top: 0, width: 360 }}
            >
              <span
                style={{
                  position: "relative",
                  zIndex: 1,
                  display: "grid",
                  placeItems: "center",
                  width: 54,
                  height: 54,
                  border: `2px solid ${C.bronze}`,
                  background: reached && travel > 0 ? C.mist : C.paper,
                  fontFamily: FONT.display,
                  fontSize: 26,
                  color: C.bronze,
                }}
              >
                {index + 1}
              </span>
              <p
                style={{
                  margin: "26px 0 0",
                  fontFamily: FONT.mono,
                  fontSize: 18,
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
                  color: C.bronze,
                }}
              >
                {moment.where}
              </p>
              <p
                style={{
                  margin: "10px 0 0",
                  fontFamily: FONT.sans,
                  fontSize: 32,
                  fontWeight: 700,
                  color: C.ink,
                }}
              >
                {moment.title}
              </p>
            </div>
          );
        })}
      </div>
      <p
        style={{
          position: "absolute",
          left: 160,
          bottom: 96,
          margin: 0,
          fontFamily: FONT.sans,
          fontSize: 24,
          color: C.slate,
        }}
      >
        Hono and Express use the same runtime for backend messages.
      </p>
    </AbsoluteFill>
  );
}
