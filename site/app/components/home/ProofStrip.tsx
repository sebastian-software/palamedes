import { useRef } from "react"
import { Link } from "react-router"

import { BENCH_REALISTIC } from "~/data/bench"
import contentStats from "~/data/generated/content-stats.json"
import { decisionHref } from "~/data/links"
import { useCountUp } from "~/hooks/useCountUp"
import { useInView } from "~/hooks/useInView"

interface Stat {
  value: string
  label: string
  href: string
}

/*
 * Counts come from content-stats.json (generated from the repo during
 * prebuild) and the ratio from bench.ts (guarded against the checked
 * benchmark report), so none of these numbers can silently drift.
 */
const STATS: Stat[] = [
  {
    value: `${contentStats.smokeExampleCount}`,
    label: "smoke-verified example apps",
    href: "/frameworks",
  },
  {
    value: `${contentStats.frameworkCount} × ${contentStats.strategyCount}`,
    label: "frameworks × locale strategies",
    href: "/frameworks",
  },
  {
    value: BENCH_REALISTIC.ratios.lingui,
    label: "faster than Lingui — realistic 1,500-file extract/update benchmark, machine-local run",
    href: "/proof",
  },
  {
    value: `${contentStats.adrCount}`,
    label: "ADRs documenting every tradeoff",
    href: decisionHref(),
  },
]

function StatCell({ stat, active }: { stat: Stat; active: boolean }) {
  const display = useCountUp(stat.value, active)
  const inner = (
    <>
      <span className="mono-nums block text-stat font-medium tracking-[-0.02em] text-accent">
        {display}
      </span>
      <span className="mt-2 block text-[12.5px] leading-snug text-gray-spec">{stat.label}</span>
    </>
  )
  const classes = "block bg-paper px-6 py-6 transition-colors hover:bg-hover-fill"
  if (stat.href.startsWith("/")) {
    return (
      <Link to={stat.href} viewTransition className={classes}>
        {inner}
      </Link>
    )
  }
  return (
    <a href={stat.href} className={classes}>
      {inner}
    </a>
  )
}

export function ProofStrip() {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref)

  return (
    <div ref={ref} className="hairline-grid grid-cols-4 border-x-0 max-grid:grid-cols-2">
      {STATS.map((stat) => (
        <StatCell key={stat.label} stat={stat} active={inView} />
      ))}
    </div>
  )
}
