import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame } from "remotion";

import { C, FONT } from "../brand";
import { BAR } from "../timeline";
import { Revealed } from "../kinetic";
import { arrive, Display, sceneFade } from "../ui";

/*
 * Framework integration. The marks of the first-party adapters
 * arrive on the beat, then a message travels the four moments every adapter
 * has to get right. Support levels stay off screen, so the film outlives them.
 */
interface IntegrationMark {
  file: string | null;
  name?: string;
  label: string | null;
  h: number;
  group: (typeof GROUPS)[number];
}

const MARKS: readonly IntegrationMark[] = [
  { file: "react", label: "React", h: 40, group: "UI libraries" },
  { file: "solid", label: "Solid", h: 40, group: "UI libraries" },
  { file: "nextjs", label: null, h: 30, group: "Frameworks" },
  { file: "tanstack", label: null, h: 46, group: "Frameworks" },
  // Waku's published SVG is drawn for dark surfaces and its icon is an emoji
  // image; the ledger forbids recolouring a mark, so the film names it instead.
  { file: null, name: "Waku", label: null, h: 32, group: "Frameworks" },
  { file: "remix", label: null, h: 26, group: "Frameworks" },
  { file: "vite", label: null, h: 30, group: "Build tool" },
];
const GROUPS = ["UI libraries", "Frameworks", "Build tool"] as const;

const MOMENTS = [
  { where: "On the server", title: "The page is rendered" },
  { where: "On the wire", title: "HTML arrives translated" },
  { where: "In the browser", title: "The page comes alive" },
  { where: "Back on the server", title: "A server action replies" },
] as const;

/** Scene frames for each mark and the travelling message. */
export interface WiringCues {
  marks: readonly number[];
  travel: readonly [number, number];
  bars: number;
}

export function Wiring({ cues }: { cues: WiringCues }) {
  const frame = useCurrentFrame();
  const travel = interpolate(frame, [...cues.travel], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  // Stations sit 400px apart; the line joins their centres (27px in).
  const STATION = 400;
  const CENTRE = 27;

  return (
    <AbsoluteFill
      style={{
        background: C.paper,
        padding: "110px 160px",
        opacity: sceneFade(frame, BAR * cues.bars),
      }}
    >
      <Display size={62} style={{ maxWidth: 1500 }}>
        <Revealed
          text={"The wiring is already built\u00a0— and tested as real apps."}
          frame={frame}
          at={3}
        />
      </Display>

      <div style={{ display: "flex", alignItems: "flex-start", marginTop: 64 }}>
        {GROUPS.map((group, groupIndex) => (
          <div
            key={group}
            style={{
              paddingLeft: groupIndex ? 48 : 0,
              marginLeft: groupIndex ? 48 : 0,
              borderLeft: groupIndex ? `1.5px solid ${C.hair}` : undefined,
            }}
          >
            <p
              style={{
                margin: 0,
                fontFamily: FONT.sans,
                fontSize: 22,
                fontWeight: 600,
                color: C.slate,
              }}
            >
              {group}
            </p>
            <div
              style={{ display: "flex", alignItems: "center", gap: 36, marginTop: 18, height: 56 }}
            >
              {MARKS.map((mark, index) =>
                mark.group === group ? (
                  <div
                    key={mark.file ?? mark.name}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      ...arrive(frame, cues.marks[index] ?? 8, 10),
                    }}
                  >
                    {mark.file ? (
                      <Img src={staticFile(`logos/${mark.file}.svg`)} style={{ height: mark.h }} />
                    ) : (
                      <span
                        style={{
                          fontFamily: FONT.sans,
                          fontSize: 34,
                          fontWeight: 800,
                          color: C.ink,
                        }}
                      >
                        {mark.name}
                      </span>
                    )}
                    {mark.label ? (
                      <span
                        style={{
                          fontFamily: FONT.sans,
                          fontSize: 26,
                          fontWeight: 700,
                          color: C.ink,
                        }}
                      >
                        {mark.label}
                      </span>
                    ) : null}
                  </div>
                ) : null,
              )}
            </div>
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
                  fontFamily: FONT.sans,
                  fontSize: 22,
                  fontWeight: 600,
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
