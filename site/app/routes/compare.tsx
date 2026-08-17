import { Link } from "react-router"

import { ButtonLink, EditorialRail, Page, Section } from "@palamedes/site-ui"
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
      "Palamedes compared — Lingui, fbtee, i18next, next-intl, React Intl, Paraglide, Intlayer, Tolgee",
    description:
      "Side-by-side comparisons of Palamedes with the major TypeScript i18n libraries: 5× to 100× faster on a checked benchmark, with what each of them does better and when to pick them instead.",
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
    answer:
      "There is no React Native adapter here. fbtee has an explicit Expo path, while Lingui and i18next also support React Native today.",
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

function measuredWorkflow(rival: (typeof RIVALS)[number]) {
  return rival.rows.find((row) => row.palamedes.includes("¹"))
}

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
          is measured faster than the five workflows covered by the checked benchmark — 5× to 100×,
          depending on the measured workflow. The 5× React Intl reference is extraction-only; the
          four catalog-update workflows span 30× to 100×. Both the product boundary and the
          benchmark scope are explicit. Every page below states what the other project earned, what
          that strength costs its users, and where we would send you elsewhere.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <ButtonLink href="/compare/lingui">Start with Lingui</ButtonLink>
          <ButtonLink variant="outline" href="/proof">
            See the proof
          </ButtonLink>
        </div>

        <EditorialRail tone="emphasis" className="mt-12 bg-hover-fill py-6 pr-6">
          <p className="micro text-[10px] tracking-label text-gray-spec">Why now</p>
          <h2 className="mt-2 max-w-[24em] text-[19px] font-bold">{NATIVE_SHIFT.title}</h2>
          <p className="mt-3 max-w-[46em] text-[15px] leading-relaxed text-ink/85">
            {NATIVE_SHIFT.body}
          </p>
        </EditorialRail>
      </section>

      <Section
        num="01 — Comparison ledger"
        title="What we measured, what we researched, and where we made no claim."
        lede={`${RIVALS.length} libraries, ${RIVALS.length} separate arguments. The ledger separates directly measured workflow results from dated research. An empty measurement is an explicit boundary, not a footnote — and each comparison starts with a verdict before the supporting detail.`}
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse border border-hair">
            <caption className="sr-only">
              Comparison ledger, separating direct workflow measurements from dated research.
            </caption>
            <thead>
              <tr>
                <th className="micro border border-hair px-4 py-3 text-left text-[10.5px] tracking-th text-gray-spec">
                  Comparison
                </th>
                <th className="micro border border-hair px-4 py-3 text-left text-[10.5px] tracking-th text-accent">
                  Measured
                </th>
                <th className="micro border border-hair px-4 py-3 text-left text-[10.5px] tracking-th text-gray-spec">
                  Researched
                </th>
                <th className="micro border border-hair px-4 py-3 text-left text-[10.5px] tracking-th text-gray-spec">
                  Detail
                </th>
              </tr>
            </thead>
            <tbody>
              {RIVALS.map((rival) => {
                const measurement = measuredWorkflow(rival)
                return (
                  <tr key={rival.slug}>
                    <th scope="row" className="border border-hair px-4 py-4 text-left align-top">
                      <p className="text-[14px] font-bold">Palamedes vs {rival.name}</p>
                      <p className="mt-1 text-[12.5px] leading-relaxed text-ink/75">{rival.card}</p>
                    </th>
                    <td className="border border-hair bg-hover-fill px-4 py-4 align-top text-[13px] leading-relaxed">
                      {measurement ? (
                        <>
                          <p className="font-bold text-accent">{measurement.palamedes}</p>
                          <p className="mt-1 text-[11.5px] text-gray-spec">
                            Scope: {measurement.criterion}
                          </p>
                        </>
                      ) : (
                        <p className="font-bold">Not measured — no claim implied.</p>
                      )}
                    </td>
                    <td className="border border-hair px-4 py-4 align-top text-[13px] leading-relaxed">
                      <p>Project and package research checked {rival.researched}.</p>
                      <p className="mt-1 text-[11.5px] text-gray-spec">
                        Observations, not a performance claim.
                      </p>
                    </td>
                    <td className="border border-hair px-4 py-4 align-top">
                      <Link
                        to={`/compare/${rival.slug}`}
                        viewTransition
                        className="mono-nums text-[13px] text-accent hover:underline"
                      >
                        Read verdict →
                      </Link>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <EditorialRail tone="emphasis" className="mt-8 bg-hover-fill py-5 pr-6">
          <h3 className="text-[15px] font-bold">Weighing something not listed here?</h3>
          <p className="mt-2 max-w-[52em] text-[13.5px] leading-relaxed text-ink/85">
            These cover the libraries most teams actually shortlist. If yours is missing, open an
            issue with the comparison you need — every page here is backed by a dated research note
            in the repository, and we would rather write one than guess.
          </p>
          <a href={`${REPO}/issues`} className="micro mt-3 inline-block text-[12px] text-accent">
            Ask on GitHub →
          </a>
        </EditorialRail>
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

        <EditorialRail className="mt-10">
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
        </EditorialRail>
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
