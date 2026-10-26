import { AbsoluteFill, Img, staticFile, useCurrentFrame } from "remotion";

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
 * guards against the checked reports: React Intl (extraction only) is left out.
 * The board stands still first, so the viewer sees the start; the clock runs
 * from the narration's cue. Scope differences go in the footnote, not the rows.
 */
const VIEWS = BENCHMARK_FRAMEWORKS.map(({ id }) => {
  const view = benchmarkView(id);
  return { ...view, rows: [...view.rows].sort((left, right) => left.medianMs - right.medianMs) };
});
const LONGEST = Math.max(...VIEWS.flatMap((view) => view.rows.map((row) => row.medianMs)));
/** Short public names; i18next-cli is i18next's own extraction CLI. */
const NAMES: Readonly<Record<string, string>> = { "i18next-cli": "i18next" };
const MARKS: Readonly<Record<string, { asset: string; w: number; h: number }>> = {
  react: { asset: "react.svg", w: 28, h: 26 },
  vue: { asset: "vue.svg", w: 25, h: 23 },
  svelte: { asset: "svelte.svg", w: 20, h: 24 },
  solid: { asset: "solid.svg", w: 26, h: 24 },
};

export function Rust({ bars, start }: { bars: number; start: number }) {
  const frame = useCurrentFrame();
  const elapsed = Math.max(0, Math.min(LONGEST, ((frame - start) / FPS) * 1000));
  // React keeps its own report; Vue, Svelte and Solid share the framework report.
  const [react, frameworks] = VIEWS;

  return (
    <AbsoluteFill
      style={{
        background: C.mist,
        padding: "90px 160px",
        opacity: sceneFade(frame, BAR * bars, 18),
      }}
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
                display: "flex",
                alignItems: "center",
                gap: 14,
                margin: 0,
                padding: "12px 24px",
                borderBottom: `1.5px solid ${C.hair}`,
                fontFamily: FONT.sans,
                fontSize: 26,
                fontWeight: 700,
                color: C.ink,
              }}
            >
              <span style={{ display: "inline-flex", justifyContent: "center", width: 40 }}>
                <Img
                  src={staticFile(`logos/${MARKS[view.framework].asset}`)}
                  style={{
                    width: MARKS[view.framework].w * 1.4,
                    height: MARKS[view.framework].h * 1.4,
                  }}
                />
              </span>
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
                    gridTemplateColumns: "230px 1fr 110px",
                    alignItems: "center",
                    gap: 20,
                    padding: "11px 24px",
                    borderTop: `1px solid ${C.hair}`,
                  }}
                >
                  <span
                    style={{
                      fontFamily: FONT.sans,
                      fontSize: 23,
                      fontWeight: 700,
                      color: row.accent ? C.bronze : C.ink,
                    }}
                  >
                    {NAMES[row.displayName] ?? row.displayName}
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
        {react.meta.generated}; Vue, Svelte and Solid {frameworks.meta.generated} · Wuchale also
        compiles; fbtee runs two commands
      </p>
    </AbsoluteFill>
  );
}
