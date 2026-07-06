import { useRef } from "react"

import { LOCALE_CARDS, LOCALE_CAPTION } from "~/data/locales"
import { useCycle } from "~/hooks/useCycle"
import { useInView } from "~/hooks/useInView"
import { usePrefersReducedMotion } from "~/hooks/usePrefersReducedMotion"

/*
 * The three-locale booking cards. After hydration (and outside reduced
 * motion) a highlight cycles en → de → es every 2.5s — a stepped emphasis,
 * not a tween. The prerendered state is the plain three-card stack.
 */
export function LocaleBookingCards() {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref)
  const reducedMotion = usePrefersReducedMotion()
  const activeIndex = useCycle(LOCALE_CARDS.length, 2500, inView)
  const cycling = !reducedMotion

  return (
    <figure ref={ref}>
      <div className="hairline-grid grid-cols-3 max-tight:grid-cols-1">
        {LOCALE_CARDS.map((card, index) => {
          const active = !cycling || index === activeIndex
          return (
            <div
              key={card.locale}
              className="bg-paper px-5 py-4 transition-opacity duration-300"
              style={{
                opacity: active ? 1 : 0.55,
                outline:
                  cycling && index === activeIndex ? "1px solid var(--color-accent)" : "none",
                outlineOffset: "-1px",
              }}
            >
              <p className="mono-nums text-[11px] text-accent">{card.locale}</p>
              <p className="mt-1 text-[17px] font-bold tracking-tight">{card.title}</p>
              <div className="mt-2 flex items-center justify-between gap-3">
                <span className="border border-hair px-2 py-0.5 text-[12.5px]">{card.seats}</span>
                <span className="mono-nums text-[14px]">{card.price}</span>
              </div>
              <p className="mono-nums mt-2 text-[12px] text-gray-spec">{card.date}</p>
            </div>
          )
        })}
      </div>
      <figcaption className="micro mt-3 text-[10px] text-gray-spec">{LOCALE_CAPTION}</figcaption>
    </figure>
  )
}
