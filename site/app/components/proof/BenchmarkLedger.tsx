import {
  BENCH_META,
  displayBenchmarkFactor,
  displayBenchmarkTime,
  type BenchCorpus,
  type BenchWarm,
} from "~/data/bench"
import { decisionHref, docsHref } from "~/data/links"

/*
 * The benchmark is a result ledger rather than a proportional chart. At the
 * realistic ratios a linear bar makes the winner unreadable, while a unit grid
 * adds dozens of marks without adding information. The table keeps exact row
 * relationships, scope, and native semantics while deliberately presenting
 * honest rounded public values. Exact medians remain in the checked source.
 */
export function BenchmarkLedger({ corpus, warm }: { corpus: BenchCorpus; warm?: BenchWarm }) {
  const baseline = corpus.rows.find((row) => row.tool === "Palamedes")
  if (!baseline) {
    throw new Error(`Benchmark corpus ${corpus.id} has no Palamedes baseline`)
  }

  const rows = [...corpus.rows].sort((left, right) => left.order - right.order)

  return (
    <div className="border border-hair">
      <div className="grid grid-cols-[1fr_auto] items-end gap-6 border-b border-hair px-6 py-5 max-tight:grid-cols-1">
        <div>
          <p className="micro text-[10px] tracking-label text-ink/70">Checked result ledger</p>
          <h3 className="display-serif mt-2 text-[20px] uppercase">{corpus.title}</h3>
        </div>
        <a href={docsHref("benchmark-e2e-workflow")} className="mono-nums text-[11px] text-accent">
          Methodology →
        </a>
      </div>

      <div
        className="overflow-x-auto focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent"
        role="region"
        aria-label="Benchmark results; scroll horizontally when needed"
        tabIndex={0}
      >
        <table className="w-full min-w-[700px] border-collapse">
          <caption className="sr-only">
            Rounded workflow times and relative factors for {corpus.corpus}. Exact values are
            available in the checked benchmark report.
          </caption>
          <thead>
            <tr className="border-b border-hair">
              <th
                scope="col"
                className="micro px-6 py-3 text-left text-[10px] tracking-th text-ink/70"
              >
                Workflow
              </th>
              <th
                scope="col"
                className="micro px-6 py-3 text-right text-[10px] tracking-th text-ink/70"
              >
                Result
              </th>
              <th
                scope="col"
                className="micro px-6 py-3 text-right text-[10px] tracking-th text-ink/70"
              >
                Relative time
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const accent = row.accent
              return (
                <tr
                  key={row.tool}
                  className={`border-b border-hair last:border-b-0 ${accent ? "bg-hover-fill" : ""}`}
                >
                  <th scope="row" className="px-6 py-5 text-left text-[14px] font-semibold">
                    {row.displayName}
                    {!row.sameScope && !accent ? (
                      <span className="mt-1 block text-[10px] font-normal text-gray-spec">
                        * extraction only; narrower scope
                      </span>
                    ) : null}
                  </th>
                  <td
                    className={`mono-nums px-6 py-5 text-right text-[clamp(1.65rem,3vw,2.4rem)] leading-none ${accent ? "text-accent" : "text-ink"}`}
                  >
                    {accent && warm
                      ? `${displayBenchmarkTime(warm.warmMs).replace(" ms", "")}–${displayBenchmarkTime(row.medianMs)}*`
                      : displayBenchmarkTime(row.medianMs)}
                  </td>
                  <td className="mono-nums px-6 py-5 text-right text-[20px] text-ink">
                    {displayBenchmarkFactor(row, baseline.medianMs)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {warm ? (
        <p className="border-t border-hair px-6 py-4 text-[11px] leading-relaxed text-gray-spec">
          * {displayBenchmarkTime(warm.warmMs)} is Palamedes on a cached re-run after{" "}
          {warm.touchedFiles}
          changed source files; {displayBenchmarkTime(baseline.medianMs)} is the cold workflow
          result. No speedup factor is calculated for the non-comparable cached run.{" "}
          <a href={decisionHref("019-extraction-cache")} className="text-accent hover:underline">
            Cache details →
          </a>
        </p>
      ) : null}

      <p className="border-t border-hair px-6 py-4 text-[11px] leading-relaxed text-gray-spec">
        Times are rounded to display precision and relative factors are rounded down. Exact medians
        remain in the checked report. Machine-local run: {BENCH_META.platform}, Node{" "}
        {BENCH_META.node}, {BENCH_META.generated}, median of {BENCH_META.runs} runs.
      </p>
    </div>
  )
}
