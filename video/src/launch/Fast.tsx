import { AbsoluteFill, useCurrentFrame } from "remotion";

import {
  BENCH_REALISTIC,
  displayBenchmarkFactor,
  displayBenchmarkTime,
} from "../../../site/app/data/bench";
import { C, FONT } from "../brand";
import { FPS } from "../timeline";
import { Label, Mono, snap, snapIn, Stage } from "./parts";
import { cue, SCENES, WORDS } from "./timeline";

/*
 * Bars 18–21: "1,500 files take under a tenth of a second. The next-fastest
 * tool needs over two." The checked realistic benchmark, Palamedes against
 * the fastest tool with the same scope, at 1:1 speed on one shared scale.
 * Values come from the site's bench data, which the site build guards
 * against the checked report; the factor is floored as on the site.
 */
const LENGTH = SCENES.fast.to - SCENES.fast.from;
const SAME_SCOPE = BENCH_REALISTIC.rows
  .filter((row) => row.accent || row.sameScope)
  .sort((left, right) => left.medianMs - right.medianMs);
const [OURS, NEXT] = SAME_SCOPE;
const START = cue(WORDS.files, "fast") + 6;

export function Fast() {
  const frame = useCurrentFrame();
  if (!OURS || !NEXT) return null;
  const elapsed = Math.max(0, ((frame - START) / FPS) * 1000);
  const factor = displayBenchmarkFactor(NEXT, OURS.medianMs);
  const rows = [OURS, NEXT];
  return (
    <Stage length={LENGTH} ground={C.mist}>
      <AbsoluteFill style={{ padding: "120px 160px", justifyContent: "center", gap: 70 }}>
        <Label style={{ fontSize: 28, ...snapIn(frame, 2) }}>
          {BENCH_REALISTIC.corpus} · extract + catalog update · median of 7 runs
        </Label>
        {rows.map((row, index) => {
          const done = elapsed >= row.medianMs;
          const fill = Math.min(1, elapsed / NEXT.medianMs);
          const own = Math.min(fill, row.medianMs / NEXT.medianMs);
          return (
            <div
              key={row.tool}
              style={{ display: "grid", gap: 18, ...snapIn(frame, 6 + index * 4) }}
            >
              <div
                style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}
              >
                <span
                  style={{ fontFamily: FONT.sans, fontSize: 58, fontWeight: 600, color: C.ink }}
                >
                  {row.displayName}
                </span>
                <Mono size={row.accent ? 120 : 96} color={row.accent ? C.bronze : C.ink}>
                  {done
                    ? displayBenchmarkTime(row.medianMs)
                    : displayBenchmarkTime(Math.min(elapsed, row.medianMs))}
                </Mono>
              </div>
              <div style={{ height: 30, background: C.white, border: `2px solid ${C.hair}` }}>
                <div
                  style={{
                    height: "100%",
                    width: `${own * 100}%`,
                    minWidth: elapsed > 0 ? 6 : 0,
                    background: row.accent ? C.bronze : C.slate,
                  }}
                />
              </div>
            </div>
          );
        })}
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 30,
            ...snapIn(frame, cue(WORDS.nextFastest, "fast") + 20, { s: 1.2 }),
          }}
        >
          <span style={{ fontFamily: FONT.display, fontSize: 150, color: C.bronze, lineHeight: 1 }}>
            {factor}
          </span>
          <span
            style={{
              fontFamily: FONT.display,
              fontSize: 64,
              color: C.ink,
              opacity: snap(frame, cue(WORDS.nextFastest, "fast") + 24),
            }}
          >
            faster, same scope
          </span>
        </div>
      </AbsoluteFill>
    </Stage>
  );
}
