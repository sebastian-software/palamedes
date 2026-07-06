import type { ReactNode } from "react"

/*
 * The dark positioning band — Home's single deliberate style break. The
 * ScopeDiagram renders, in developer-facing terms, the part Palamedes owns
 * (stable across frameworks) vs. the part your framework owns (differs per
 * stack) — and the payoff line: switching frameworks only touches the bottom
 * row. Labels are intentionally plain, not the internal architecture names.
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

const OWNED = ["write messages", "extract & update", "catalog (.po)", "runtime lookup"]
const HOST = ["routing & URLs", "locale detection", "rendering", "hosting"]

function ScopeDiagram() {
  return (
    <div
      className="mt-12 max-w-[44em]"
      role="img"
      aria-label="Palamedes owns the part that stays the same on every framework: writing messages, extract and update, the .po catalog, and the runtime lookup, all on one Rust core. Your framework owns the part that differs per stack: routing and URLs, locale detection, rendering, and hosting. Switching frameworks only changes that bottom row."
    >
      <p className="micro text-[10px] tracking-label text-accent-soft">
        Palamedes owns it — same on every framework
      </p>
      <div className="mt-2 grid grid-cols-4 gap-px border border-accent-soft/40 bg-accent-soft/40 max-tight:grid-cols-2">
        {OWNED.map((label) => (
          <span
            key={label}
            className="mono-nums bg-ink px-3 py-2.5 text-center text-[11px] text-paper"
          >
            {label}
          </span>
        ))}
      </div>
      <p className="mono-nums mt-1.5 text-center text-[10px] tracking-label text-accent-soft uppercase">
        └─── one Rust core, everywhere ───┘
      </p>
      <div className="mx-auto my-3 h-6 w-px bg-accent-soft/40" aria-hidden />
      <p className="micro text-[10px] tracking-label text-gray-spec">
        Your framework owns it — different on every stack
      </p>
      <div className="mt-2 grid grid-cols-4 gap-px border border-paper/20 bg-paper/20 max-tight:grid-cols-2">
        {HOST.map((label) => (
          <span
            key={label}
            className="mono-nums bg-ink px-3 py-2.5 text-center text-[11px] text-gray-spec"
          >
            {label}
          </span>
        ))}
      </div>
      <p className="mt-6 text-[15px] text-paper">
        Switch frameworks, and only the bottom row changes.{" "}
        <span className="text-accent-soft">The top row is the same code you already wrote.</span>
      </p>
    </div>
  )
}
