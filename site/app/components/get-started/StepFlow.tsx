import { EditorialRail } from "@palamedes/site-ui"
import type { Step } from "~/data/steps"

/*
 * Vertical numbered step flow: 64px mono number rail with a connective
 * vertical hairline (the page's accent-tinted style break), step body with
 * optional code block and aside.
 */
export function StepFlow({ steps }: { steps: Step[] }) {
  return (
    <ol className="relative border border-hair">
      <span
        aria-hidden
        className="absolute top-0 bottom-0 left-8 w-px bg-accent/30 max-tight:left-[22px]"
      />
      {steps.map((step, index) => (
        <li
          key={step.title}
          /*
           * minmax(0,1fr), not a bare 1fr: a bare `1fr` resolves to
           * minmax(auto,1fr), so the content column refuses to shrink below
           * the intrinsic width of the code block inside it and widens the
           * page instead of letting the <pre> scroll.
           */
          className={`grid grid-cols-[64px_minmax(0,1fr)] max-tight:grid-cols-[44px_minmax(0,1fr)] ${
            index > 0 ? "border-t border-hair" : ""
          }`}
        >
          <div className="relative border-r border-hair py-5 text-center">
            <span className="mono-nums relative z-10 inline-block border border-accent bg-paper px-1.5 py-0.5 text-[12px] text-accent">
              {String(index + 1).padStart(2, "0")}
            </span>
          </div>
          <div className="px-6 py-5 max-tight:px-4">
            <h3 className="text-[15px] font-bold">{step.title}</h3>
            <p className="mt-1.5 max-w-[52em] text-[13.5px] leading-relaxed text-ink/85">
              {step.body}
            </p>
            {step.code ? (
              <pre
                className="mt-4 overflow-x-auto bg-ink px-4 py-3 font-mono text-[12px] leading-[1.7] text-paper/90 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-paper"
                tabIndex={0}
              >
                {step.code}
              </pre>
            ) : null}
            {index === 0 ? (
              <EditorialRail tone="emphasis" className="mt-4">
                <p className="micro text-[10px] text-gray-spec">Package boundary</p>
                <p className="mt-1 text-[12.5px] leading-relaxed">
                  Install the scoped <code>@palamedes/*</code> packages shown above. The top-level{" "}
                  <code>palamedes</code> and <code>create-palamedes</code> names are reserved for a
                  future one-command setup and are not the entry point today.
                </p>
              </EditorialRail>
            ) : null}
            {step.aside ? (
              <EditorialRail className="mt-4">
                <p className="micro text-[10px] text-gray-spec">Aside</p>
                <p className="mt-1 text-[12.5px] text-gray-spec">{step.aside}</p>
              </EditorialRail>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  )
}
