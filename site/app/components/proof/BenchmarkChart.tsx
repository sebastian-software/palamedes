import { useRef } from "react"

import { BENCH_META, type BenchCorpus } from "~/data/bench"
import { docsHref } from "~/data/links"
import { useInView } from "~/hooks/useInView"
import { usePrefersReducedMotion } from "~/hooks/usePrefersReducedMotion"

const TICK_STEP_MS = 100

/*
 * Custom spec-sheet bar chart: linear ms scale (no silent truncation),
 * hairline ticks every 100ms, accent bar for Palamedes with the checked
 * speedup ratios annotated at the bar end. Bars grow on first view;
 * prerender/no-JS/reduced-motion shows full-width bars.
 */
export function BenchmarkChart({ corpus }: { corpus: BenchCorpus }) {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref)
  const reducedMotion = usePrefersReducedMotion()
  const animate = !reducedMotion && inView
  const maxMs = Math.max(...corpus.rows.map((row) => row.medianMs))
  const ticks = Array.from({ length: Math.floor(maxMs / TICK_STEP_MS) }, (_, i) =>
    Math.round(((i + 1) * TICK_STEP_MS * 100) / maxMs)
  )

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
              className="grid grid-cols-[minmax(100px,10em)_1fr_minmax(90px,7em)] items-center gap-3 max-tight:grid-cols-1"
            >
              <span className="mono-nums text-[12px]">{row.tool}</span>
              <div className="relative h-[18px] border border-hair bg-track">
                {ticks.map((left) => (
                  <span
                    key={left}
                    aria-hidden
                    className="absolute top-0 bottom-0 w-px bg-hair"
                    style={{ left: `${left}%` }}
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
                {row.accent ? (
                  <span className="mono-nums absolute top-1/2 left-[7%] -translate-y-1/2 text-[10px] whitespace-nowrap text-accent">
                    {corpus.ratios.lingui} vs Lingui · {corpus.ratios.i18next} vs i18next
                  </span>
                ) : null}
              </div>
              <span className="mono-nums text-right text-[12.5px]">
                {row.medianMs.toFixed(2)} ms
              </span>
            </div>
          )
        })}
        <div className="mono-nums grid grid-cols-[minmax(100px,10em)_1fr_minmax(90px,7em)] gap-3 text-[10px] text-gray-spec max-tight:hidden">
          <span />
          <span>0{ticks.map((_, i) => ` · ${(i + 1) * TICK_STEP_MS}`)} ms — linear scale</span>
          <span />
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
