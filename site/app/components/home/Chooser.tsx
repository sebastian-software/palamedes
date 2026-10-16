import { Link } from "react-router";

import { Band, BandHeader } from "~/components/marketing/Band";
import { NOT_FOR_YOU } from "~/data/fit";
import { RIVALS } from "~/data/rivals";

/*
 * For the reader who is comparing: one line per alternative (each comparison
 * page's own headline) and, just as visibly, the cases where another tool is
 * the better choice.
 */
export function Chooser() {
  return (
    <Band tone="parchment" labelledBy="chooser-title">
      <BandHeader
        id="chooser-title"
        kicker="Choosing a library?"
        title="Already using something else? Here’s the honest difference."
        lede="Every comparison opens with what the other project does well, separates measured results from research, and says when you should not switch."
      />
      <ul className="mt-14 grid grid-cols-1 gap-px border border-hair bg-hair sm:grid-cols-2 xl:grid-cols-4">
        {RIVALS.map((rival) => (
          <li key={rival.slug} className="bg-paper">
            <Link
              to={`/compare/${rival.slug}`}
              viewTransition
              className="group flex h-full flex-col px-6 py-6 transition-colors hover:bg-hover-fill focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent"
            >
              <span className="micro text-[11px] tracking-label text-gray-spec">Palamedes vs</span>
              <span className="mt-1 text-[21px] font-bold tracking-[-0.01em] group-hover:text-accent">
                {rival.name}
              </span>
              <span className="mt-3 text-[15px] leading-relaxed text-ink/80">{rival.headline}</span>
              <span aria-hidden className="mt-auto pt-4 text-accent">
                →
              </span>
            </Link>
          </li>
        ))}
      </ul>

      <div className="mt-16 grid grid-cols-1 gap-x-14 gap-y-8 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,2fr)]">
        <h3 className="display-serif text-[clamp(1.6rem,1.1rem+1.4vw,2.3rem)] leading-[1.1]">
          When Palamedes is not the right choice.
        </h3>
        <ul className="grid grid-cols-1 gap-x-10 gap-y-7 sm:grid-cols-2">
          {NOT_FOR_YOU.map((entry) => (
            <li key={entry.case} className="border-t border-hair pt-4">
              <p className="text-[17px] font-bold">{entry.case}</p>
              <p className="mt-2 text-[15.5px] leading-relaxed text-ink/80">{entry.answer}</p>
            </li>
          ))}
        </ul>
      </div>
    </Band>
  );
}
