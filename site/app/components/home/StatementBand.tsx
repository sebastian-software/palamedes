import type { ReactNode } from "react"

/*
 * The dark positioning band — Home's single deliberate style break. The
 * ScopeDiagram renders what Palamedes owns vs. what the adapter/host owns.
 */
export function StatementBand({
  num,
  diagram = false,
  children,
}: {
  num: string
  diagram?: boolean
  children: ReactNode
}) {
  return (
    <section className="border-t border-hair bg-ink px-8 pt-0 pb-16 text-paper max-tight:px-5">
      <div className="meander -mx-8 mb-14 max-tight:-mx-5" aria-hidden />
      <p className="micro tracking-th text-accent-soft">{num}</p>
      <p className="display-serif mt-6 max-w-[32em] text-band leading-[1.4]">{children}</p>
      {diagram ? <ScopeDiagram /> : null}
    </section>
  )
}

const OWNED = ["transform", "extract", "catalog", "runtime"]
const HOST = ["routing", "locale negotiation", "rendering", "deployment"]

function ScopeDiagram() {
  return (
    <div
      className="mt-12 max-w-[44em]"
      role="img"
      aria-label="Palamedes owns transform, extract, catalog, and runtime via ferrocat and the Rust core; the adapter and host framework own routing, locale negotiation, rendering, and deployment."
    >
      <p className="micro text-[10px] tracking-label text-accent-soft">Palamedes owns</p>
      <div className="mt-2 grid grid-cols-4 gap-px border border-accent-soft/40 bg-accent-soft/40 max-tight:grid-cols-2">
        {OWNED.map((label) => (
          <span
            key={label}
            className="mono-nums bg-ink px-3 py-2.5 text-center text-[11px] text-paper uppercase"
          >
            {label}
          </span>
        ))}
      </div>
      <p className="mono-nums mt-1.5 text-center text-[10px] tracking-label text-accent-soft uppercase">
        └── ferrocat + rust core ──┘
      </p>
      <div className="mx-auto my-3 h-6 w-px bg-accent-soft/40" aria-hidden />
      <p className="micro text-[10px] tracking-label text-gray-spec">Adapter / host owns</p>
      <div className="mt-2 grid grid-cols-4 gap-px border border-paper/20 bg-paper/20 max-tight:grid-cols-2">
        {HOST.map((label) => (
          <span
            key={label}
            className="mono-nums bg-ink px-3 py-2.5 text-center text-[11px] text-gray-spec uppercase"
          >
            {label}
          </span>
        ))}
      </div>
    </div>
  )
}
