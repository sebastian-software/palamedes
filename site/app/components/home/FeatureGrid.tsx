import { Link } from "react-router"

import type { FeatureCard } from "~/data/features"
import { FeatureIcon } from "~/components/icons/FeatureIcon"

interface FeatureGridProps {
  cards: FeatureCard[]
  columns?: 2 | 3 | 4
}

const COLUMN_CLASSES = {
  2: "grid-cols-2 max-tight:grid-cols-1",
  3: "grid-cols-3 max-grid:grid-cols-2 max-tight:grid-cols-1",
  4: "grid-cols-4 max-grid:grid-cols-2 max-tight:grid-cols-1",
}

export function FeatureGrid({ cards, columns = 3 }: FeatureGridProps) {
  return (
    <div className={`hairline-grid ${COLUMN_CLASSES[columns]}`}>
      {cards.map((card) => (
        <div key={card.title} className="bg-paper px-6 py-6">
          <FeatureIcon name={card.icon} className="text-accent" />
          <h3 className="mt-5 text-[15px] font-bold">{card.title}</h3>
          <p className="mt-2 text-[13.5px] leading-relaxed text-ink/85">{card.body}</p>
          {card.href ? (
            /* Static files like /llms.txt are same-origin but not routes. */
            card.href.startsWith("/") && !card.href.includes(".") ? (
              <Link
                to={card.href}
                viewTransition
                className="micro mt-4 inline-block text-[12px] text-accent hover:text-ink"
              >
                More →
              </Link>
            ) : (
              <a
                href={card.href}
                className="micro mt-4 inline-block text-[12px] text-accent hover:text-ink"
              >
                More →
              </a>
            )
          ) : null}
        </div>
      ))}
    </div>
  )
}
