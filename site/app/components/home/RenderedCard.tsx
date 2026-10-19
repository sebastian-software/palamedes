import { useState } from "react";

import { SPECIMEN_LOCALES, specimenSeats } from "~/data/specimen";

/*
 * The last stop of the tour: the component as a visitor sees it. Switching
 * the language swaps the catalog; the seat stepper shows that each language
 * brings its own plural rules. Prerendered state: English, three seats.
 */
export function RenderedCard() {
  const [index, setIndex] = useState(0);
  const [seats, setSeats] = useState(3);
  const active = SPECIMEN_LOCALES[index] ?? SPECIMEN_LOCALES[0];

  return (
    <figure className="border border-ink bg-paper">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-hair px-5 py-3">
        <p className="micro text-[11px] tracking-label text-gray-spec">In the browser</p>
        <div role="group" aria-label="Visitor language" className="flex flex-wrap gap-1">
          {SPECIMEN_LOCALES.map((entry, position) => (
            <button
              key={entry.locale}
              type="button"
              data-analytics-id={`rendered-card-locale-${entry.locale}`}
              data-analytics-event="demo_locale"
              data-analytics-value={entry.locale}
              aria-pressed={position === index}
              onClick={() => setIndex(position)}
              className="mono-nums min-h-11 min-w-11 border border-transparent px-2 text-[12px] tracking-[0.08em] text-ink/75 transition-colors hover:border-hair hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent aria-pressed:border-ink aria-pressed:bg-mist aria-pressed:font-semibold aria-pressed:text-ink"
            >
              {entry.label}
              <span className="sr-only"> ({entry.name})</span>
            </button>
          ))}
        </div>
      </div>
      <div className="px-6 py-8">
        <article
          lang={active.locale}
          aria-label={`Rendered card in ${active.name}`}
          className="border border-hair bg-white px-6 py-6"
        >
          <p className="text-[24px] leading-tight font-bold tracking-[-0.01em] text-ink">
            {active.title}
          </p>
          <p className="mt-4 inline-block border border-accent px-2.5 py-1 text-[14px] text-accent">
            {specimenSeats(active, seats)}
          </p>
        </article>
        <div className="mt-5 flex flex-wrap items-center gap-3 text-[14px] text-ink/80">
          <span id="rendered-seats-label">Seats left</span>
          <div role="group" aria-labelledby="rendered-seats-label" className="flex items-center">
            <button
              type="button"
              className="min-h-11 min-w-11 border border-hair text-[16px] hover:border-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent disabled:opacity-40"
              onClick={() => setSeats((value) => Math.max(1, value - 1))}
              disabled={seats <= 1}
              aria-label="One seat fewer"
              data-analytics-id="rendered-card-seats-decrease"
            >
              −
            </button>
            <output
              className="mono-nums min-w-10 text-center text-[15px] text-ink"
              aria-live="polite"
            >
              {seats}
            </output>
            <button
              type="button"
              className="min-h-11 min-w-11 border border-hair text-[16px] hover:border-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent disabled:opacity-40"
              onClick={() => setSeats((value) => Math.min(9, value + 1))}
              disabled={seats >= 9}
              aria-label="One seat more"
              data-analytics-id="rendered-card-seats-increase"
            >
              +
            </button>
          </div>
          <span className="text-gray-spec">Try 1 — each language has its own plural rules.</span>
        </div>
      </div>
    </figure>
  );
}
