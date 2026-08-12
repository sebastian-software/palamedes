import { BENCH_META, type BenchCorpus, type BenchRow, type BenchWarm } from "~/data/bench"
import { docsHref } from "~/data/links"

const TOOL_ORDER = ["Palamedes", "React Intl", "Lingui", "General Translation", "i18next-cli"]

function displayTime(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`
}

function displayFactor(row: BenchRow, baselineMs: number): string {
  return row.tool === "Palamedes" ? "1×" : `${Math.floor(row.medianMs / baselineMs)}×`
}

function scopeFor(tool: string): string {
  return tool === "React Intl" ? "extraction only · narrower scope" : "extract + catalog update"
}

function displayTool(tool: string): string {
  return tool === "General Translation" ? "GT" : tool
}

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

  const rows = [...corpus.rows].sort(
    (left, right) => TOOL_ORDER.indexOf(left.tool) - TOOL_ORDER.indexOf(right.tool)
  )

  return (
    <div className="border border-hair">
      <div className="grid grid-cols-[1fr_auto] items-end gap-6 border-b border-hair px-6 py-5 max-tight:grid-cols-1">
        <div>
          <p className="micro text-[9px] tracking-label text-gray-spec">Checked result ledger</p>
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
                className="micro px-6 py-3 text-left text-[9px] tracking-th text-gray-spec"
              >
                Workflow
              </th>
              <th
                scope="col"
                className="micro px-6 py-3 text-right text-[9px] tracking-th text-gray-spec"
              >
                Result
              </th>
              <th
                scope="col"
                className="micro px-6 py-3 text-right text-[9px] tracking-th text-gray-spec"
              >
                Relative time
              </th>
              <th
                scope="col"
                className="micro px-6 py-3 text-left text-[9px] tracking-th text-gray-spec"
              >
                Scope
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const accent = row.tool === "Palamedes"
              return (
                <tr
                  key={row.tool}
                  className={`border-b border-hair last:border-b-0 ${accent ? "bg-hover-fill" : ""}`}
                >
                  <th scope="row" className="px-6 py-5 text-left text-[14px] font-semibold">
                    {displayTool(row.tool)}
                  </th>
                  <td
                    className={`mono-nums px-6 py-5 text-right text-[clamp(1.65rem,3vw,2.4rem)] leading-none ${accent ? "text-accent" : "text-ink"}`}
                  >
                    {displayTime(row.medianMs)}
                  </td>
                  <td className="mono-nums px-6 py-5 text-right text-[20px] text-ink">
                    {displayFactor(row, baseline.medianMs)}
                  </td>
                  <td className="px-6 py-5 text-[12px] text-gray-spec">{scopeFor(row.tool)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {warm ? (
        <div className="grid grid-cols-[auto_1fr] items-center gap-5 border-t border-hair bg-ink px-6 py-5 text-paper max-tight:grid-cols-1">
          <span className="mono-nums text-[32px] leading-none text-accent-soft">
            {displayTime(warm.warmMs)}
          </span>
          <p className="text-[12.5px] leading-relaxed text-paper/80">
            Cached re-run after touching {warm.touchedFiles} source files. It is shown separately:
            no public speedup factor is calculated from the warm lane.
          </p>
        </div>
      ) : null}

      <p className="border-t border-hair px-6 py-4 text-[11px] leading-relaxed text-gray-spec">
        Times are rounded to display precision and relative factors are rounded down. Exact medians
        remain in the checked report. Machine-local run: {BENCH_META.platform}, Node{" "}
        {BENCH_META.node}, {BENCH_META.generated}, median of {BENCH_META.runs} runs.
      </p>
    </div>
  )
}
