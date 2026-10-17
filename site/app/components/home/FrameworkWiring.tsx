import { Reveal } from "@palamedes/site-ui";
import { Link } from "react-router";

import { Band, BandHeader } from "~/components/marketing/Band";
import contentStats from "~/data/generated/content-stats.json";
import { FRAMEWORKS } from "~/data/matrix";

/*
 * Why framework integration is the real work, explained as the four moments
 * a server-rendered page lives through. Each moment names what the adapter
 * guarantees; the verified examples exercise all four.
 */
const MOMENTS = [
  {
    where: "On the server",
    title: "The page is rendered",
    body: "The adapter knows the visitor’s language and loads that catalog once, shared by every request that needs it.",
  },
  {
    where: "On the wire",
    title: "HTML arrives translated",
    body: "Visitors and search engines get finished text in the first response — no flash of English while scripts load.",
  },
  {
    where: "In the browser",
    title: "The page comes alive",
    body: "The same words survive hydration, and screens loaded later bring their own messages.",
  },
  {
    where: "Back on the server",
    title: "A server action replies",
    body: "Code that runs later — a form submission, a server function — still answers in the visitor’s language.",
  },
] as const;

const URL_SHAPES = [
  {
    name: "Cookie",
    url: ["example.com/checkout", "", ""],
    body: "One address for every language; the choice is remembered. Great for signed-in apps.",
  },
  {
    name: "Path",
    url: ["example.com", "/de", "/checkout"],
    body: "A path per language. Easy to index and share — the classic for public sites.",
  },
  {
    name: "Subdomain",
    url: ["", "de.", "example.com/checkout"],
    body: "A host per language or market. Clean splits for CDNs and analytics.",
  },
  {
    name: "Country domain",
    url: ["example", ".de", "/checkout"],
    body: "A local domain per market, each mapped to its language.",
  },
] as const;

export function FrameworkWiring() {
  return (
    <Band id="frameworks" labelledBy="wiring-title">
      <BandHeader
        id="wiring-title"
        kicker="Framework integration"
        title="The hard part isn’t translating. It’s the wiring."
        lede="Modern frameworks run your components in several places — on the server, in the browser, inside server actions. The right messages must be ready in each place, for each visitor, at the right moment. Palamedes ships that wiring as a first-party adapter for your framework, and tests it as a real app."
      />

      <div className="pmds-flow relative mt-16">
        <span aria-hidden className="pmds-flow-line" />
        <span aria-hidden className="pmds-flow-token" />
        <ol className="relative grid grid-cols-1 gap-y-10 md:grid-cols-2 md:gap-x-10 xl:grid-cols-4">
          {MOMENTS.map((moment, index) => (
            <li key={moment.title} className="min-w-0">
              <span
                aria-hidden
                className="display-serif relative z-10 grid size-10 place-items-center border border-accent bg-paper text-[17px] text-accent"
              >
                {index + 1}
              </span>
              <p className="micro mt-5 text-[11px] tracking-label text-accent">{moment.where}</p>
              <h3 className="mt-2 text-[19px] leading-snug font-bold">{moment.title}</h3>
              <p className="mt-2 max-w-[22rem] text-[15.5px] leading-relaxed text-ink/80">
                {moment.body}
              </p>
            </li>
          ))}
        </ol>
      </div>
      <p className="mt-6 max-w-[46rem] text-[16px] leading-relaxed text-ink/80">
        Without an adapter, every one of these moments is glue code you write and maintain. With
        Palamedes it is a package for {FRAMEWORKS.map((framework) => framework.name).join(", ")},
        and Vite — Hono and Express use the same runtime for backend messages.{" "}
        <Link to="/frameworks" viewTransition className="pmds-arrow-link">
          Find your framework →
        </Link>
      </p>

      <div className="mt-20 grid grid-cols-1 gap-x-14 gap-y-8 border-t border-hair pt-14 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,2fr)]">
        <Reveal>
          <h3 className="display-serif text-[clamp(1.6rem,1.1rem+1.4vw,2.3rem)] leading-[1.1]">
            Where does the language live in your URL?
          </h3>
          <p className="mt-4 text-[16px] leading-relaxed text-ink/80">
            Your app decides; Palamedes doesn’t force a routing scheme. All four common answers run
            as example apps — {FRAMEWORKS.length} frameworks × {contentStats.localeStrategyCount}{" "}
            URL shapes, each checked in CI.
          </p>
          <Link to="/locale-routing" viewTransition className="pmds-arrow-link mt-3">
            Which one fits your product? →
          </Link>
        </Reveal>
        <ul className="grid grid-cols-1 gap-px border border-hair bg-hair sm:grid-cols-2">
          {URL_SHAPES.map((shape) => (
            <li key={shape.name} className="min-w-0 bg-paper px-5 py-6">
              <p className="mono-nums truncate border border-ink/60 bg-white px-3 py-2.5 text-[13px] text-ink/75">
                {shape.url[0]}
                <span className="font-semibold text-accent">{shape.url[1]}</span>
                {shape.url[2]}
              </p>
              <p className="mt-5 text-[17px] font-bold">{shape.name}</p>
              <p className="mt-2 text-[15px] leading-relaxed text-ink/80">{shape.body}</p>
            </li>
          ))}
        </ul>
      </div>
    </Band>
  );
}
