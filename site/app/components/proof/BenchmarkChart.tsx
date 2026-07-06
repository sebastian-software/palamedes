import { useRef } from "react"

import { BENCH_META, type BenchCorpus } from "~/data/bench"
import { docsHref } from "~/data/links"
import { useInView } from "~/hooks/useInView"
import { usePrefersReducedMotion } from "~/hooks/usePrefersReducedMotion"

/* Tick step that keeps the axis to ~8-10 gridlines whatever the range. */
function chooseStep(dataMax: number): number {
  if (dataMax <= 1000) return 100
  if (dataMax <= 3000) return 250
  if (dataMax <= 6000) return 500
  return 1000
}

/*
 * Round a data maximum up to a clean axis maximum (a whole multiple of the
 * tick step) that always leaves visible headroom, so the longest bar never
 * ends hard on the frame.
 */
function niceAxisMaxMs(dataMax: number, stepMs: number): number {
  const rounded = Math.ceil(dataMax / stepMs) * stepMs
  return rounded - dataMax < stepMs / 2 ? rounded + stepMs : rounded
}

/*
 * Custom spec-sheet bar chart: linear ms scale (no silent truncation),
 * hairline ticks at an adaptive step, one accent bar for Palamedes. The axis
 * maximum rounds up to a clean number with headroom. Bars grow on first view;
 * prerender/no-JS/reduced-motion shows full-width bars.
 */
export function BenchmarkChart({ corpus }: { corpus: BenchCorpus }) {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref)
  const reducedMotion = usePrefersReducedMotion()
  const animate = !reducedMotion && inView
  const dataMax = Math.max(...corpus.rows.map((row) => row.medianMs))
  const step = chooseStep(dataMax)
  const maxMs = niceAxisMaxMs(dataMax, step)
  const tickValues: number[] = []
  for (let value = step; value < maxMs; value += step) {
    tickValues.push(value)
  }

  return (
    <div ref={ref} className="border border-hair">
      <p className="micro border-b border-hair px-5 py-3 text-[10.5px] tracking-label text-gray-spec">
        {corpus.title}
      </p>
      <div className="space-y-3 px-5 py-5">
        {corpus.rows.map((row, index) => {
          const widthPercent = (row.medianMs / maxMs) * 100
          return (
            <div
              key={row.tool}
              className="grid grid-cols-[160px_1fr_112px] items-center gap-3 max-tight:grid-cols-1"
            >
              <span className="mono-nums text-[12px]">{row.tool}</span>
              <div className="relative h-[18px] border border-hair bg-track">
                {tickValues.map((value) => (
                  <span
                    key={value}
                    aria-hidden
                    className="absolute top-0 bottom-0 w-px bg-hair"
                    style={{ left: `${(value / maxMs) * 100}%` }}
                  />
                ))}
                <div
                  className={`absolute inset-y-0 left-0 ${row.accent ? "bg-accent" : "bg-ink"}`}
                  style={{
                    width: `${widthPercent}%`,
                    transformOrigin: "left",
                    transform: reducedMotion || inView ? "scaleX(1)" : "scaleX(0)",
                    transition: animate ? `transform 600ms ease-out ${index * 120}ms` : undefined,
                  }}
                />
              </div>
              <span className="mono-nums text-right text-[12.5px]">
                {Math.round(row.medianMs)} ms
              </span>
            </div>
          )
        })}
        <div className="grid grid-cols-[160px_1fr_112px] gap-3 text-[10px] text-gray-spec max-tight:hidden">
          <span />
          <div className="relative h-4" aria-hidden>
            <span className="mono-nums absolute top-0 left-0">0</span>
            {tickValues.map((value) => (
              <span
                key={value}
                className="mono-nums absolute top-0 -translate-x-1/2"
                style={{ left: `${(value / maxMs) * 100}%` }}
              >
                {value}
              </span>
            ))}
            <span className="mono-nums absolute top-0 right-0">{maxMs}</span>
          </div>
          <span className="mono-nums text-right">ms · linear</span>
        </div>
      </div>
      <p className="border-t border-hair px-5 py-3 text-[12px] text-gray-spec">
        Machine-local run ({BENCH_META.platform}, Node {BENCH_META.node}, {BENCH_META.generated}),
        median of {BENCH_META.runs} runs — not a marketing average.{" "}
        <a href={docsHref("benchmark-e2e-workflow")} className="mono-nums text-accent">
          Methodology →
        </a>
      </p>
    </div>
  )
}
