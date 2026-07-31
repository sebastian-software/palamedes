import { useRef } from "react"

import type { BenchWarm } from "~/data/bench"
import { decisionHref, docsHref } from "~/data/links"
import { useInView } from "~/hooks/useInView"
import { usePrefersReducedMotion } from "~/hooks/usePrefersReducedMotion"

/*
 * The warm lane, shown as Palamedes against its own cold run — the only
 * comparison this lane supports. The compared tools have no local extraction
 * cache, so their warm runs cost what their cold runs cost; putting them in
 * these bars would read as a speedup claim the report explicitly refuses to
 * make. The honest note below says so rather than leaving it implied.
 *
 * Bars share the chart's scale rules: linear ms, widest bar sets the frame.
 */
export function WarmLane({ corpus }: { corpus: BenchWarm }) {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref)
  const reducedMotion = usePrefersReducedMotion()
  const animate = !reducedMotion && inView
  const saved = Math.round(((corpus.coldMs - corpus.warmMs) / corpus.coldMs) * 100)
  const lanes = [
    { label: "Cold — full extract", ms: corpus.coldMs, accent: false },
    { label: `Warm — after ${corpus.touchedFiles} edits`, ms: corpus.warmMs, accent: true },
  ]

  return (
    <div ref={ref} className="border border-hair">
      <p className="micro border-b border-hair px-5 py-3 text-[10.5px] tracking-label text-gray-spec">
        The next run — {corpus.corpus} (median of 7 runs)
      </p>
      <div className="space-y-3 px-5 py-5">
        {lanes.map((lane, index) => (
          <div
            key={lane.label}
            className="grid grid-cols-[160px_1fr_112px] items-center gap-3 max-tight:grid-cols-1"
          >
            <span className="mono-nums text-[12px]">{lane.label}</span>
            <div className="relative h-[18px] border border-hair bg-track">
              <div
                className={`absolute inset-y-0 left-0 ${lane.accent ? "bg-accent" : "bg-ink"}`}
                style={{
                  width: `${(lane.ms / corpus.coldMs) * 100}%`,
                  transformOrigin: "left",
                  transform: reducedMotion || inView ? "scaleX(1)" : "scaleX(0)",
                  transition: animate ? `transform 600ms ease-out ${index * 120}ms` : undefined,
                }}
              />
            </div>
            <span className="mono-nums text-right text-[12.5px]">{Math.round(lane.ms)} ms</span>
          </div>
        ))}
      </div>
      <p className="border-t border-hair px-5 py-3 text-[12px] text-gray-spec">
        Touch {corpus.touchedFiles} files, re-run, and {saved}% of the work is gone: extraction is
        cached per file and validated by <code>stat</code>, so unchanged files are neither read nor
        parsed{" "}
        <a href={decisionHref("019-extraction-cache")} className="mono-nums text-accent">
          (ADR-019)
        </a>
        . This is a capability the compared tools do not have — they re-extract in full, so their
        warm runs cost what their cold runs cost. That is why this lane is kept out of every speedup
        number.{" "}
        <a href={docsHref("benchmark-e2e-workflow")} className="mono-nums text-accent">
          Methodology →
        </a>
      </p>
    </div>
  )
}
