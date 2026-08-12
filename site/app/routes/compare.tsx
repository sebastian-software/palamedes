import { Link } from "react-router"

import { ButtonLink, Page, Section } from "@palamedes/site-ui"
import { pageMeta } from "~/lib/meta"
import { CtaBand } from "~/components/home/CtaBand"
import { StatementBand } from "~/components/home/StatementBand"
import contentStats from "~/data/generated/content-stats.json"
import { REPO, decisionHref, docsHref } from "~/data/links"
import { NATIVE_SHIFT, RIVALS } from "~/data/rivals"

export const handle = { layout: "bare" }

export function meta() {
  return pageMeta({
    title:
      "Palamedes compared — Lingui, i18next, next-intl, React Intl, Paraglide, Intlayer, Tolgee",
    description:
      "Side-by-side comparisons of Palamedes with the major TypeScript i18n libraries: 5× to 79× faster on a checked benchmark, with what each of them does better and when to pick them instead.",
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
      "Paraglide's zero-runtime compilation beats a runtime layer on bundle size by construction. If that is the number you are judged on, start there.",
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
          Compare it properly. We&nbsp;will argue the other side for you.
        </h1>
        <p className="mt-6 max-w-[42em]">
          Palamedes combines broad framework and workflow coverage with fewer competing concepts. It
          is measured faster than the four workflows covered by the checked benchmark — 5× to 79×,
          depending on the measured workflow. The 5× React Intl reference is extraction-only; the
          three catalog-update workflows span 29× to 79×. Both the product boundary and the
          benchmark scope are explicit. Every page below states what the other project earned, what
          that strength costs its users, and where we would send you elsewhere.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <ButtonLink href="/compare/lingui">Start with Lingui</ButtonLink>
          <ButtonLink variant="outline" href="/proof">
            See the proof
          </ButtonLink>
        </div>

        <div className="mt-12 border-l-4 border-accent bg-hover-fill px-6 py-6">
          <p className="micro text-[10px] tracking-label text-gray-spec">Why now</p>
          <h2 className="mt-2 max-w-[24em] text-[19px] font-bold">{NATIVE_SHIFT.title}</h2>
          <p className="mt-3 max-w-[46em] text-[15px] leading-relaxed text-ink/85">
            {NATIVE_SHIFT.body}
          </p>
        </div>
      </section>

      <Section
        num="01 — Head to head"
        title="Pick the one you are actually weighing."
        lede={`${RIVALS.length} libraries, ${RIVALS.length} separate arguments. Each page runs the same structure: credit and cost side by side, the decisions that genuinely differ, a code comparison, a measured table, and an explicit 'pick them instead when…' list. None of it needs you to take our word for anything.`}
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
        </div>
        {/* Outside the grid on purpose: the rival count is even, so this would
            otherwise leave a half-empty row. As a full-width strip it also
            reads as an invitation rather than as one more comparison. */}
        <div className="mt-8 border-l-4 border-accent bg-hover-fill px-6 py-5">
          <h3 className="text-[15px] font-bold">Weighing something not listed here?</h3>
          <p className="mt-2 max-w-[52em] text-[13.5px] leading-relaxed text-ink/85">
            These cover the libraries most teams actually shortlist. If yours is missing, open an
            issue with the comparison you need — every page here is backed by a dated research note
            in the repository, and we would rather write one than guess.
          </p>
          <a href={`${REPO}/issues`} className="micro mt-3 inline-block text-[12px] text-accent">
            Ask on GitHub →
          </a>
        </div>
      </Section>

      <Section
        num="02 — Not for you"
        title="When the honest answer is 'use something else'."
        lede="Every tool has edges, and pretending otherwise wastes your afternoon. In these four situations another library is simply the better call — you should not have to read four sections and a benchmark to find that out."
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
        num="03 — ICU semantics"
        title="The durable claim is about the pipeline we control."
        lede="ICU support varies across libraries, TMS products, file formats and project settings, and any table claiming otherwise ages badly. Palamedes makes a bounded, executable claim instead: nested ICU selectors stay intact from source through transformation, PO catalogs, compilation and runtime rendering."
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

        <div className="mt-10 max-w-[60em] border-l-4 border-gray-spec pl-5">
          <p className="micro text-[10px] tracking-label text-gray-spec">
            The best argument against us
          </p>
          <h3 className="mt-2 text-[15px] font-bold">
            Mozilla&apos;s Project Fluent thinks ICU is the wrong shape.
          </h3>
          <p className="mt-2 text-[13.5px] leading-relaxed text-ink/85">
            Fluent&apos;s case is worth stating properly, because it is the strongest one anybody
            makes. In ICU, the structure of a message is fixed by the source language: if English
            needs no gender agreement, the message has no gender selector, and a translator into a
            language that does need one cannot add it without a developer editing the source. Fluent
            inverts that — a translation may introduce selectors and grammatical machinery the
            original never had. It ships in Firefox, so this is proven at scale, not theoretical.
          </p>
          <p className="mt-3 text-[13.5px] leading-relaxed text-ink/85">
            We chose ICU anyway, for reasons we will defend: TMS and CAT tools process it directly,
            and it keeps PO catalogs interoperable across a mixed localization toolchain.
            Fluent&apos;s expressiveness is real; its format instead requires Fluent-aware tooling.
            The client architecture also differs: <code>@fluent/react</code> resolves through a
            React provider and does not supply a server-components path. If morphologically rich
            target languages require translation-authored selectors, read Fluent&apos;s technical
            case rather than ours.
          </p>
        </div>
      </Section>

      <StatementBand num="04 — The honest bit">
        Every tool on these pages is good software, built by people who thought hard about the
        problem — and every one of them was designed against a JavaScript toolchain that has since
        been rebuilt underneath them. We started on the other side of that line. If our tradeoffs do
        not match your team, all {contentStats.adrCount} of them are written down, so you can find
        that out today rather than in month four.
      </StatementBand>

      <CtaBand
        headline="Judge it by the receipts, not the copy."
        primary={{ label: "See the proof", href: "/proof" }}
        secondary={{
          label: "Try the 5-minute quickstart",
          href: "/get-started",
        }}
      />
    </Page>
  )
}
