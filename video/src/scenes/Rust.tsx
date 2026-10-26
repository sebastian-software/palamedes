import { AbsoluteFill, useCurrentFrame } from "remotion";

import { displayBenchmarkTime } from "../../../site/app/data/bench";
import { BENCHMARK_FRAMEWORKS, benchmarkView } from "../../../site/app/data/framework-bench";
import { C, FONT } from "../brand";
import { BAR, FPS } from "../timeline";
import { Revealed } from "../kinetic";
import { arrive, Display, sceneFade } from "../ui";

/*
 * The checked realistic benchmarks for React, Vue, Svelte and Solid at 1:1
 * speed, side by side. Every bar fills in exactly its measured median on one
 * shared clock and one shared scale, so the race ends after the slowest tool's
 * real time. Rows come from the site's benchmarkView(), which the site build
 * guards against the checked reports: React Intl (extraction only) is left out,
 * and a tool doing broader work than extract + update says so beside its name.
 */
const VIEWS = BENCHMARK_FRAMEWORKS.map(({ id }) => {
  const view = benchmarkView(id);
  return { ...view, rows: [...view.rows].sort((left, right) => left.medianMs - right.medianMs) };
});
const LONGEST = Math.max(...VIEWS.flatMap((view) => view.rows.map((row) => row.medianMs)));
const START = 14; // frames before the clock starts
const SAME_SCOPE = "extract + catalog update";

export function Rust({ bars }: { bars: number }) {
  const frame = useCurrentFrame();
  const elapsed = Math.max(0, Math.min(LONGEST, ((frame - START) / FPS) * 1000));
  // React keeps its own report; Vue, Svelte and Solid share the framework report.
  const [react, frameworks] = VIEWS;

  return (
    <AbsoluteFill
      style={{ background: C.mist, padding: "90px 160px", opacity: sceneFade(frame, BAR * bars) }}
    >
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
        <Display size={60} style={{ whiteSpace: "nowrap" }}>
          <Revealed text="Fast in every framework." frame={frame} at={3} />
        </Display>
        <span style={{ textAlign: "right", ...arrive(frame, 6) }}>
          <span style={{ display: "block", fontFamily: FONT.mono, fontSize: 20, color: C.slate }}>
            Extract + catalog update · {frameworks.corpus}
          </span>
          <span
            style={{
              display: "block",
              marginTop: 6,
              fontFamily: FONT.mono,
              fontSize: 40,
              color: C.ink,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {(elapsed / 1000).toFixed(2)} s
          </span>
        </span>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 28,
          marginTop: 44,
        }}
      >
        {VIEWS.map((view, index) => (
          <div
            key={view.framework}
            style={{
              border: `1.5px solid ${C.hair}`,
              background: C.paper,
              ...arrive(frame, 6 + index * 2),
            }}
          >
            <p
              style={{
                margin: 0,
                padding: "14px 24px",
                borderBottom: `1.5px solid ${C.hair}`,
                fontFamily: FONT.sans,
                fontSize: 26,
                fontWeight: 700,
                color: C.ink,
              }}
            >
              {view.label}
            </p>
            {view.rows.map((row) => {
              const done = elapsed >= row.medianMs;
              const width = (Math.min(elapsed, row.medianMs) / LONGEST) * 100;
              return (
                <div
                  key={row.tool}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "300px 1fr 110px",
                    alignItems: "center",
                    gap: 20,
                    padding: "9px 24px",
                    borderTop: `1px solid ${C.hair}`,
                  }}
                >
                  <span style={{ lineHeight: 1.1 }}>
                    <span
                      style={{
                        display: "block",
                        fontFamily: FONT.sans,
                        fontSize: 23,
                        fontWeight: 700,
                        color: row.accent ? C.bronze : C.ink,
                      }}
                    >
                      {row.displayName}
                    </span>
                    {row.scope === SAME_SCOPE ? null : (
                      <span style={{ fontFamily: FONT.sans, fontSize: 15, color: C.gray }}>
                        {row.scope}
                      </span>
                    )}
                  </span>
                  <span style={{ display: "block", height: 14, background: C.mist }}>
                    <span
                      style={{
                        display: "block",
                        height: "100%",
                        width: `max(${width}%, ${elapsed > 0 ? 4 : 0}px)`,
                        background: row.accent ? C.bronze : C.slate,
                        opacity: row.accent ? 1 : 0.7,
                      }}
                    />
                  </span>
                  <span
                    style={{
                      textAlign: "right",
                      fontFamily: FONT.mono,
                      fontSize: 24,
                      color: row.accent ? C.bronze : C.ink,
                      opacity: done ? 1 : 0.25,
                    }}
                  >
                    {displayBenchmarkTime(row.medianMs)}
                  </span>
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <p style={{ margin: "20px 0 0", fontFamily: FONT.sans, fontSize: 20, color: C.slate }}>
        Played back in real time · median of {react.meta.runs} runs · {react.meta.platform} · React{" "}
        {react.meta.generated}; Vue, Svelte and Solid {frameworks.meta.generated}
      </p>
    </AbsoluteFill>
  );
}
