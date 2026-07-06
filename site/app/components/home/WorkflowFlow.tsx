import { Fragment } from "react"

/*
 * The four-stage workflow map that frames the code showcase below it: the same
 * Write / Extract / Translate labels as the tabs, plus the artifact each stage
 * produces, connected left-to-right. Stays inside the Swiss spec grid — hairline
 * cells, mono labels, one accent on the terminal stage. Arrows turn downward
 * when the row collapses to a single column.
 */

interface FlowStage {
  label: string
  artifact: string
  note: string
  accent?: boolean
}

const STAGES: FlowStage[] = [
  { label: "Write", artifact: "src/*.tsx", note: "t`…` macro in the component" },
  { label: "Extract", artifact: "pmds", note: "one native command", accent: true },
  { label: "Translate", artifact: ".po catalog", note: "source-string-first" },
  { label: "Render", artifact: "every framework", note: "same runtime model" },
]

export function WorkflowFlow() {
  return (
    <div
      className="grid grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr] items-stretch gap-0 max-grid:grid-cols-1"
      role="img"
      aria-label="Workflow: write messages in source, extract with pmds, translate the .po catalog, render in every framework."
    >
      {STAGES.map((stage, index) => (
        <Fragment key={stage.label}>
          {index > 0 ? (
            <span
              aria-hidden
              className="flex items-center justify-center px-3 text-gray-spec max-grid:py-2"
            >
              <span className="max-grid:hidden">→</span>
              <span className="hidden max-grid:inline">↓</span>
            </span>
          ) : null}
          <div
            className={`border px-4 py-4 ${
              stage.accent ? "border-accent bg-hover-fill" : "border-hair"
            }`}
          >
            <p className="micro text-[10px] tracking-label text-gray-spec">
              {String(index + 1).padStart(2, "0")}
            </p>
            <p
              className={`display-serif mt-1 text-[17px] ${stage.accent ? "text-accent" : "text-ink"}`}
            >
              {stage.label}
            </p>
            <p className="mono-nums mt-2 text-[11px] text-ink">{stage.artifact}</p>
            <p className="mt-0.5 text-[11px] text-gray-spec">{stage.note}</p>
          </div>
        </Fragment>
      ))}
    </div>
  )
}
