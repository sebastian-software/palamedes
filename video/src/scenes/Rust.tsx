import { AbsoluteFill, useCurrentFrame } from "remotion";

import { BENCH_META, BENCH_REALISTIC, displayBenchmarkTime } from "../../../site/app/data/bench";
import { C, FONT } from "../brand";
import { BAR, FPS } from "../timeline";
import { Revealed } from "../kinetic";
import { arrive, Display, sceneFade } from "../ui";

/*
 * Bars 17–19: the checked realistic benchmark at 1:1 speed. Every bar fills in
 * exactly its measured median, so the race ends after the slowest tool's real
 * time. Numbers come from site/app/data/bench.ts, which the site build guards
 * against the checked report; scope stays beside every row.
 */
const ROWS = [...BENCH_REALISTIC.rows].sort((left, right) => left.medianMs - right.medianMs);
const LONGEST = Math.max(...ROWS.map((row) => row.medianMs));
const START = 14; // frames before the clock starts

export function Rust() {
  const frame = useCurrentFrame();
  const elapsed = Math.max(0, Math.min(LONGEST, ((frame - START) / FPS) * 1000));

  return (
    <AbsoluteFill
      style={{ background: C.mist, padding: "100px 160px", opacity: sceneFade(frame, BAR * 3) }}
    >
      <Display size={60}>
        <Revealed text="Why Rust?" frame={frame} at={3} />
        <br />
        <Revealed text="Because nobody likes waiting for their tools." frame={frame} at={9} />
      </Display>
      <div
        style={{
          marginTop: 54,
          border: `1.5px solid ${C.hair}`,
          background: C.paper,
          ...arrive(frame, 6),
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            padding: "18px 30px",
            borderBottom: `1.5px solid ${C.hair}`,
            fontFamily: FONT.mono,
            fontSize: 22,
            color: C.slate,
          }}
        >
          <span>Extract + catalog update · {BENCH_REALISTIC.corpus}</span>
          <span style={{ color: C.ink, fontSize: 28, fontVariantNumeric: "tabular-nums" }}>
            {(elapsed / 1000).toFixed(2)} s
          </span>
        </div>
        {ROWS.map((row) => {
          const done = elapsed >= row.medianMs;
          const width = (Math.min(elapsed, row.medianMs) / LONGEST) * 100;
          const accent = row.tool === "Palamedes";
          return (
            <div
              key={row.tool}
              style={{
                display: "grid",
                gridTemplateColumns: "360px 1fr 170px",
                alignItems: "center",
                gap: 30,
                padding: "15px 30px",
                borderTop: `1px solid ${C.hair}`,
              }}
            >
              <span>
                <span
                  style={{
                    display: "block",
                    fontFamily: FONT.sans,
                    fontSize: 28,
                    fontWeight: 700,
                    color: accent ? C.bronze : C.ink,
                  }}
                >
                  {row.displayName}
                </span>
                <span style={{ fontFamily: FONT.sans, fontSize: 18, color: C.gray }}>
                  {row.scope}
                </span>
              </span>
              <span style={{ display: "block", height: 18, background: C.mist }}>
                <span
                  style={{
                    display: "block",
                    height: "100%",
                    width: `max(${width}%, ${elapsed > 0 ? 4 : 0}px)`,
                    background: accent ? C.bronze : C.slate,
                    opacity: accent ? 1 : 0.7,
                  }}
                />
              </span>
              <span
                style={{
                  textAlign: "right",
                  fontFamily: FONT.mono,
                  fontSize: 30,
                  color: accent ? C.bronze : C.ink,
                  opacity: done ? 1 : 0.25,
                }}
              >
                {displayBenchmarkTime(row.medianMs)}
              </span>
            </div>
          );
        })}
      </div>
      <p style={{ margin: "22px 0 0", fontFamily: FONT.sans, fontSize: 22, color: C.slate }}>
        Played back in real time · median of {BENCH_META.runs} runs · {BENCH_META.platform} ·{" "}
        {BENCH_META.generated}
      </p>
    </AbsoluteFill>
  );
}
