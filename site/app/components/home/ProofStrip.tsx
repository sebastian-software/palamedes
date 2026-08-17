import { Link } from "react-router"

import { BENCH_REALISTIC, displayBenchmarkFactor } from "~/data/bench"
import contentStats from "~/data/generated/content-stats.json"
import { decisionHref } from "~/data/links"

interface Stat {
  value: string
  label: string
  href: string
  icon: string
}

/*
 * Counts come from generated repository stats.
 * The range deliberately excludes React Intl because its benchmark has a
 * narrower extraction-only scope. bench.ts is guarded against the checked
 * benchmark report, so none of these numbers can silently drift.
 */
const baseline = BENCH_REALISTIC.rows.find((row) => row.tool === "Palamedes")
const sameScopeRows = BENCH_REALISTIC.rows.filter((row) => row.sameScope)

if (!baseline || sameScopeRows.length !== 3) {
  throw new Error("Realistic benchmark is missing the expected same-scope workflows")
}

const sameScopeFactors = sameScopeRows.map((row) =>
  Number.parseInt(displayBenchmarkFactor(row, baseline.medianMs), 10)
)
const factorRange = `${Math.min(...sameScopeFactors)}–${Math.max(...sameScopeFactors)}×`

const STATS: Stat[] = [
  {
    value: `${contentStats.serverFrameworkCount}`,
    label: "first-party server-framework integrations",
    href: "/frameworks",
    icon: "app-widgets-plugin-extension",
  },
  {
    value: `${contentStats.localeStrategyCount}`,
    label: "implemented locale architectures",
    href: "/frameworks",
    icon: "globe-app-network",
  },
  {
    value: factorRange,
    label: "faster than the three same-scope workflows in the checked realistic run",
    href: "/proof",
    icon: "browser-flash",
  },
  {
    value: `${contentStats.adrCount}`,
    label: "ADRs documenting every tradeoff",
    href: decisionHref(),
    icon: "programming-book",
  },
]

function StatCell({ stat }: { stat: Stat }) {
  const inner = (
    <>
      <span className="mono-nums block text-stat font-medium tracking-[-0.02em] text-accent">
        {stat.value}
      </span>
      <img
        src={`/icons/streamline/sharp-duo/${stat.icon}.svg`}
        width={24}
        height={24}
        alt=""
        aria-hidden
        className="mt-3"
      />
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
  return (
    <div className="hairline-grid grid-cols-4 border-x-0 max-grid:grid-cols-2">
      {STATS.map((stat) => (
        <StatCell key={stat.label} stat={stat} />
      ))}
    </div>
  )
}
