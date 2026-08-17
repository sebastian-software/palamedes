import { BENCH_META, BENCH_REALISTIC, displayBenchmarkTime } from "~/data/bench"

const baselineMs = BENCH_REALISTIC.rows.find((row) => row.accent)?.medianMs ?? Number.NaN
const slowestSameScope = BENCH_REALISTIC.rows
  .filter((row) => row.sameScope)
  .reduce((slowest, row) => (row.medianMs > slowest.medianMs ? row : slowest))

if (Number.isNaN(baselineMs)) throw new Error("Realistic benchmark is missing its baseline")

export function BenchmarkCommand() {
  return (
    <figure className="border border-hair bg-ink text-paper">
      <figcaption className="flex items-center justify-between gap-4 border-b border-paper/20 px-5 py-3">
        <span className="micro text-[10px] tracking-label text-accent-soft">
          Reproducible command
        </span>
        <span className="mono-nums text-[10px] text-paper/65">{BENCH_META.generated}</span>
      </figcaption>
      <pre
        className="overflow-x-auto px-5 py-5 font-mono text-[12px] leading-[1.8] text-paper/85 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-paper"
        tabIndex={0}
      >
        <code>{`$ pnpm benchmark:e2e-workflow

realistic corpus  ${BENCH_REALISTIC.corpus}
Palamedes        ${displayBenchmarkTime(baselineMs)}  extract + catalog update
${slowestSameScope.displayName.padEnd(16)} ${displayBenchmarkTime(slowestSameScope.medianMs)}  same scope

exact report, fixtures, and semantic checks: checked in`}</code>
      </pre>
    </figure>
  )
}
