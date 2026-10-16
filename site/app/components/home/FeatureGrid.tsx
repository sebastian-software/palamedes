import { Link } from "react-router";

import type { FeatureCard } from "~/data/features";
import { FeatureIcon } from "~/components/icons/FeatureIcon";

interface FeatureGridProps {
  cards: FeatureCard[];
  columns?: 2 | 3 | 4;
}

const COLUMN_CLASSES = {
  2: "grid-cols-2 max-tight:grid-cols-1",
  3: "grid-cols-3 max-grid:grid-cols-2 max-tight:grid-cols-1",
  4: "grid-cols-4 max-grid:grid-cols-2 max-tight:grid-cols-1",
};

export function FeatureGrid({ cards, columns = 3 }: FeatureGridProps) {
  return (
    <ul className={`hairline-grid ${COLUMN_CLASSES[columns]}`}>
      {cards.map((card) => (
        <li key={card.title} className="flex flex-col bg-paper px-7 py-8">
          <FeatureIcon name={card.icon} className="size-8" />
          <h3 className="mt-5 text-[18px] leading-snug font-bold tracking-[-0.01em]">
            {card.title}
          </h3>
          <p className="mt-2 text-[15.5px] leading-relaxed text-ink/80">{card.body}</p>
          {card.href ? (
            /* Static files like /llms.txt are same-origin but not routes. */
            card.href.startsWith("/") && !card.href.includes(".") ? (
              <Link
                to={card.href}
                viewTransition
                className="pmds-arrow-link mt-auto self-start pt-3"
                aria-label={`${card.title}: read more`}
              >
                Read more →
              </Link>
            ) : (
              <a
                href={card.href}
                className="pmds-arrow-link mt-auto self-start pt-3"
                aria-label={`${card.title}: read more`}
              >
                Read more →
              </a>
            )
          ) : null}
        </li>
      ))}
    </ul>
  );
}
