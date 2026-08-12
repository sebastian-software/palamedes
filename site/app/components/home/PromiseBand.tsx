import { BENCH_REALISTIC, displayBenchmarkTime } from "~/data/bench"

const baseline = BENCH_REALISTIC.rows.find((row) => row.accent)

if (!baseline) {
  throw new Error("Realistic benchmark is missing its baseline")
}

const PROMISES = [
  {
    number: "01",
    word: "Clear",
    label: "One authoring and runtime model",
    receipt: "Source-local messages · one getI18n() contract",
  },
  {
    number: "02",
    word: "Complete",
    label: "The complete local workflow",
    receipt: "First-party adapters · catalogs · audits · compilation",
  },
  {
    number: "03",
    word: "Fast",
    label: "Native, cached tooling",
    receipt: `${displayBenchmarkTime(baseline.medianMs)} realistic run · checked report`,
  },
] as const

export function PromiseBand() {
  return (
    <section
      aria-label="Palamedes product promises"
      className="hairline-grid grid-cols-3 border-x-0 max-grid:grid-cols-1"
    >
      {PROMISES.map((promise) => (
        <div key={promise.word} className="bg-paper px-7 py-7">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="display-serif text-[clamp(1.5rem,2.8vw,2.35rem)] uppercase">
              {promise.word}
            </h2>
            <span className="mono-nums text-[11px] text-accent">{promise.number}</span>
          </div>
          <p className="mt-5 text-[14px] font-semibold">{promise.label}</p>
          <p className="micro mt-2 text-[10px] leading-relaxed tracking-label text-ink/70">
            {promise.receipt}
          </p>
        </div>
      ))}
    </section>
  )
}
