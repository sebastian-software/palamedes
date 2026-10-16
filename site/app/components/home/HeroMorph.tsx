import { useRef, useState } from "react";

import { HERO_MESSAGE, HERO_MORPH } from "~/data/journey";
import { useCycle } from "~/hooks/useCycle";
import { useInView } from "~/hooks/useInView";
import { usePrefersReducedMotion } from "~/hooks/usePrefersReducedMotion";

/*
 * The hero's proof of the promise: the one sentence a developer writes, and
 * the same sentence as visitors read it in six languages. After hydration it
 * steps through the locales; reduced motion and no-JS show the full list.
 */
export function HeroMorph() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref);
  const reducedMotion = usePrefersReducedMotion();
  const [paused, setPaused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const index = useCycle(HERO_MORPH.length, 2200, inView && !paused && !hovered);
  const active = HERO_MORPH[index] ?? HERO_MORPH[0];

  return (
    <div
      ref={ref}
      className="border border-ink/25 bg-paper"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <p className="border-b border-hair bg-listing px-6 py-4 font-mono text-[13.5px] text-ink/80">
        <span className="micro mr-3 text-[11px] tracking-label text-slate">You write</span>
        <span className="text-slate">{"<Trans>"}</span>
        <span className="font-semibold text-accent">{HERO_MESSAGE}</span>
        <span className="text-slate">{"</Trans>"}</span>
      </p>
      <div className="px-6 pt-6 pb-7">
        <p className="micro text-[11px] tracking-label text-slate">Your visitors read</p>
        {reducedMotion ? (
          <ul className="mt-4 space-y-2.5" aria-label="The same sentence in six languages">
            {HERO_MORPH.map((entry) => (
              <li key={entry.locale} className="flex items-baseline gap-4">
                <span className="w-7 shrink-0 font-mono text-[12px] tracking-[0.12em] text-accent uppercase">
                  {entry.locale}
                </span>
                <span
                  lang={entry.locale}
                  dir={entry.dir}
                  className="text-[clamp(1.2rem,1rem+0.9vw,1.6rem)] leading-snug text-ink"
                >
                  {entry.text}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <>
            <p className="mt-5 flex min-h-[2.6em] items-baseline gap-4 text-[clamp(1.6rem,1rem+2.2vw,2.75rem)] leading-tight">
              <span className="w-8 shrink-0 font-mono text-[13px] tracking-[0.12em] text-accent uppercase">
                {active.locale}
              </span>
              <span
                key={active.locale}
                lang={active.locale}
                dir={active.dir}
                className="pmds-morph min-w-0 text-ink [overflow-wrap:anywhere]"
              >
                {active.text}
              </span>
            </p>
            <div className="mt-5 flex items-center justify-between gap-4">
              <ul className="flex gap-1.5" aria-hidden>
                {HERO_MORPH.map((entry, position) => (
                  <li
                    key={entry.locale}
                    className={`h-[3px] w-7 transition-colors ${position === index ? "bg-accent" : "bg-mist-deep"}`}
                  />
                ))}
              </ul>
              <button
                type="button"
                onClick={() => setPaused((value) => !value)}
                className="micro min-h-11 px-2 text-[11px] tracking-label text-slate hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                {paused ? "Play" : "Pause"}
                <span className="sr-only"> language animation</span>
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
