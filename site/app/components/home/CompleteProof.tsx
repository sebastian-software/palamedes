import { Link } from "react-router"

import { FRAMEWORKS, STRATEGIES } from "~/data/matrix"

import { WorkflowFlow } from "./WorkflowFlow"

function EvidenceAxis({
  label,
  value,
  title,
  items,
  note,
}: {
  label: string
  value: string
  title: string
  items: readonly string[]
  note: string
}) {
  return (
    <div className="bg-paper px-6 py-6">
      <div className="flex items-start justify-between gap-6 border-b border-hair pb-5">
        <div>
          <p className="micro text-[9px] tracking-label text-gray-spec">{label}</p>
          <h3 className="display-serif mt-2 text-[21px] uppercase">{title}</h3>
        </div>
        <span className="mono-nums text-[42px] leading-none text-accent">{value}</span>
      </div>
      <ul className="mt-5 grid grid-cols-2 gap-x-5 gap-y-2 max-tight:grid-cols-1">
        {items.map((item) => (
          <li key={item} className="flex items-center gap-2 text-[13px]">
            <span aria-hidden className="size-1.5 bg-accent" />
            {item}
          </li>
        ))}
      </ul>
      <p className="mt-5 text-[12px] leading-relaxed text-gray-spec">{note}</p>
    </div>
  )
}

export function CompleteProof() {
  return (
    <div className="space-y-10">
      <div className="hairline-grid grid-cols-2 max-grid:grid-cols-1">
        <EvidenceAxis
          label="Integration breadth"
          value={String(FRAMEWORKS.length)}
          title="Frameworks"
          items={FRAMEWORKS.map((framework) => framework.name)}
          note="First-party adapter code and verified host wiring — not a compatibility logo wall."
        />
        <EvidenceAxis
          label="Deployment breadth"
          value={String(STRATEGIES.length)}
          title="Locale architectures"
          items={STRATEGIES.map((strategy) => strategy.name)}
          note="Cookie, route, subdomain, and TLD are implemented application shapes, not documentation-only recipes."
        />
      </div>

      <div>
        <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="micro text-[9px] tracking-label text-gray-spec">The local workflow</p>
            <p className="mt-2 max-w-[42rem] text-[13.5px]">
              One path from source to a runtime artifact, with catalog audits and semantic merging
              using the same engine.
            </p>
          </div>
          <Link to="/frameworks" viewTransition className="mono-nums text-[12px] text-accent">
            Inspect the verified matrix →
          </Link>
        </div>
        <WorkflowFlow />
      </div>
    </div>
  )
}
