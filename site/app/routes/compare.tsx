import { Link } from "react-router"

import { ButtonLink } from "~/components/chrome/Button"
import { Page } from "~/components/chrome/Page"
import { pageMeta } from "~/lib/meta"
import { Section } from "~/components/chrome/Section"
import { CtaBand } from "~/components/home/CtaBand"
import { StatementBand } from "~/components/home/StatementBand"
import contentStats from "~/data/generated/content-stats.json"
import { REPO, docsHref } from "~/data/links"
import { RIVALS } from "~/data/rivals"

export const handle = { layout: "bare" }

export function meta() {
  return pageMeta({
    title: "Palamedes compared — Lingui, i18next, next-intl, react-intl, Paraglide",
    description:
      "Honest, side-by-side comparisons of Palamedes with the major JavaScript i18n libraries — including what each of them does better and when you should pick them instead.",
    path: "/compare",
  })
}

/* The cases where the answer is "use something else", stated plainly. */
const NOT_FOR_YOU = [
  {
    case: "You build with Vue, Angular, or Svelte",
    answer:
      "Palamedes ships React and Solid packages only. Lingui covers Vue, i18next covers nearly everything, and vue-i18n is the idiomatic choice inside the Vue ecosystem.",
  },
  {
    case: "You ship React Native",
    answer: "There is no React Native adapter here. Lingui and i18next both support it today.",
  },
  {
    case: "Kilobytes are your hard constraint",
    answer:
      "Paraglide's zero-runtime compilation beats a small runtime on bundle size by construction. If that is the number you are judged on, start there.",
  },
  {
    case: "You want the i18n library to own routing",
    answer:
      "next-intl treats localized pathnames and domain routing as core product. Palamedes leaves URLs to your router on purpose.",
  },
]

export default function Compare() {
  return (
    <Page>
      <section className="px-8 pt-16 pb-14 max-tight:px-5">
        <p className="eyebrow">Comparison</p>
        <h1 className="mt-6 max-w-[12em] text-display leading-[0.98] font-bold tracking-[-0.03em] text-balance">
          Narrower than the alternatives. On&nbsp;purpose.
        </h1>
        <p className="mt-6 max-w-[40em]">
          Palamedes is for teams that like compile-time authoring and want the stack under it to
          feel smaller, steadier, and easier to trust. Every page below opens with what the other
          project does better, because a comparison that cannot say that is just an ad.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <ButtonLink href="/compare/lingui">Start with Lingui</ButtonLink>
          <ButtonLink variant="outline" href="/proof">
            See the proof
          </ButtonLink>
        </div>
      </section>

      <Section
        num="01 — Head to head"
        title="Pick the one you are actually weighing."
        lede="Five libraries, five separate arguments. Each page names the other side's strengths first, then the handful of decisions that genuinely differ, with a code comparison and a 'pick them instead when…' list."
      >
        <div className="hairline-grid grid-cols-2 max-tight:grid-cols-1">
          {RIVALS.map((rival) => (
            <Link
              key={rival.slug}
              to={`/compare/${rival.slug}`}
              viewTransition
              className="group bg-paper px-6 py-6 transition-colors hover:bg-hover-fill"
            >
              <p className="micro text-[10px] tracking-label text-gray-spec">
                Palamedes vs {rival.name}
              </p>
              <h3 className="mt-3 text-[17px] font-bold group-hover:text-accent">
                {rival.headline}
              </h3>
              <p className="mt-2 text-[13.5px] leading-relaxed text-ink/85">{rival.card}</p>
              <span className="micro mt-4 inline-block text-[12px] text-accent">
                Read the comparison →
              </span>
            </Link>
          ))}
          {/* Five rivals in a two-column grid leaves an odd cell; this fills it
              with the one thing a comparison hub cannot answer for you. */}
          <div className="bg-paper px-6 py-6">
            <p className="micro text-[10px] tracking-label text-gray-spec">Palamedes vs</p>
            <h3 className="mt-3 text-[17px] font-bold">Something not listed here?</h3>
            <p className="mt-2 text-[13.5px] leading-relaxed text-ink/85">
              These five cover the libraries most teams actually shortlist. If you are weighing a
              different one, open an issue with the comparison you need and we will research it
              properly rather than guess.
            </p>
            <a href={`${REPO}/issues`} className="micro mt-4 inline-block text-[12px] text-accent">
              Ask on GitHub →
            </a>
          </div>
        </div>
      </Section>

      <Section
        num="02 — Not for you"
        title="When the honest answer is 'use something else'."
        lede="These are not edge cases we are hedging against. They are the situations where another tool is simply the better call, and you should not have to read four sections to find that out."
      >
        <div className="hairline-grid grid-cols-2 max-tight:grid-cols-1">
          {NOT_FOR_YOU.map((entry) => (
            <div key={entry.case} className="bg-paper px-6 py-6">
              <h3 className="text-[15px] font-bold">{entry.case}</h3>
              <p className="mt-2 text-[13.5px] leading-relaxed text-ink/85">{entry.answer}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section
        num="03 — Different category"
        title="Translation platforms are not the same question."
        lede="General Translation, Crowdin, Lokalise, Phrase and the rest solve hosted workflows, vendor management and delivery. Palamedes is local-first tooling: your repository owns the catalogs, the QA and the history. The two layers stack rather than compete — Palamedes underneath, a platform on top, .po as the handover format both understand."
      />

      <Section
        num="04 — ICU semantics"
        title="The durable claim is about the pipeline we control."
        lede="ICU support varies across libraries, TMS products, file formats and project settings, and any table claiming otherwise ages badly. Palamedes makes a narrower, executable claim instead: nested ICU selectors stay intact from source through transformation, PO catalogs, compilation and runtime rendering."
      >
        <div className="hairline-grid grid-cols-2 max-tight:grid-cols-1">
          <div className="bg-paper px-6 py-6">
            <h3 className="text-[15px] font-bold">What we prove</h3>
            <p className="mt-2 text-[13.5px] leading-relaxed text-ink/85">
              One checked fixture exercises nested select and plural branches across extraction,
              transformation, catalog update, compilation, and six executions of the transformed
              runtime function. You can re-run it yourself.
            </p>
          </div>
          <div className="bg-paper px-6 py-6">
            <h3 className="text-[15px] font-bold">What we only snapshot</h3>
            <p className="mt-2 text-[13.5px] leading-relaxed text-ink/85">
              Statements about other tools on these pages are dated observations from their public
              documentation and repositories — not permanent claims about their internals or where
              they are heading.
            </p>
          </div>
        </div>
        <a
          href={docsHref("icu-semantics-proof")}
          className="mono-nums mt-6 block text-[13px] text-accent"
        >
          Re-run the proof and inspect the sources →
        </a>
      </Section>

      <StatementBand num="05 — The honest bit">
        Every tool on these pages is good software, maintained by people who thought hard about the
        problem. The question is which set of tradeoffs matches your team — ours are written down in{" "}
        {contentStats.adrCount} ADRs, so you can check the reasoning before you commit to anything.
      </StatementBand>

      <CtaBand
        headline="Judge it by the receipts, not the copy."
        primary={{ label: "See the proof", href: "/proof" }}
        secondary={{ label: "Try the 5-minute quickstart", href: "/get-started" }}
      />
    </Page>
  )
}
