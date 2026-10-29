import { Fragment } from "ardo/react";

import { PIPELINE } from "~/data/steps";

export function PipelineDiagram() {
  return (
    <p
      className="mono-nums flex flex-wrap items-center gap-3 text-[13px] uppercase"
      aria-label={`The local loop: ${PIPELINE.join(", then ")}`}
    >
      {PIPELINE.map((stage, index) => (
        <Fragment key={stage}>
          {index > 0 ? (
            <span aria-hidden className="text-gray-spec">
              →
            </span>
          ) : null}
          <span className="border border-ink/40 bg-paper px-4 py-2.5 tracking-label">{stage}</span>
        </Fragment>
      ))}
      <span aria-hidden className="text-gray-spec">
        →
      </span>
      <span className="border border-accent px-4 py-2.5 tracking-label text-accent">repeat</span>
    </p>
  );
}
