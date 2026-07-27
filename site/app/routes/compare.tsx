import { Link } from "react-router"

import { ButtonLink } from "~/components/chrome/Button"
import { Page } from "~/components/chrome/Page"
import { pageMeta } from "~/lib/meta"
import { Section } from "~/components/chrome/Section"
import { CtaBand } from "~/components/home/CtaBand"
import { StatementBand } from "~/components/home/StatementBand"
import contentStats from "~/data/generated/content-stats.json"
import { BENCH_REALISTIC } from "~/data/bench"
import { REPO, decisionHref, docsHref } from "~/data/links"
import { FUNDING } from "~/data/funding"
import { PLATFORMS, PLATFORMS_RESEARCHED } from "~/data/platforms"
import { NATIVE_SHIFT, RIVALS } from "~/data/rivals"

export const handle = { layout: "bare" }

export function meta() {
  return pageMeta({
    title:
      "Palamedes compared — Lingui, i18next, next-intl, react-intl, Paraglide, Intlayer, General Translation, Tolgee",
    description: `Side-by-side comparisons of Palamedes with the major JavaScript i18n libraries: ${BENCH_REALISTIC.ratios.formatjs} to ${BENCH_REALISTIC.ratios.i18nextCli} faster on a checked benchmark, with what each of them does better and when to pick them instead.`,
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
          Compare it properly. We&nbsp;will argue the other side for you.
        </h1>
        <p className="mt-6 max-w-[42em]">
          Palamedes is narrower than many alternatives and measured faster than the four workflows
          covered by the checked benchmark — {BENCH_REALISTIC.ratios.formatjs} to{" "}
          {BENCH_REALISTIC.ratios.i18nextCli}, depending on the measured tool. Both the product
          boundary and the benchmark scope are explicit. Every page below states what the other
          project earned, what that strength costs its users, and where we would send you elsewhere.
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
        lede="A narrow tool has edges, and pretending otherwise wastes your afternoon. In these four situations another library is simply the better call — you should not have to read four sections and a benchmark to find that out."
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
        title="Translation platforms stack with us. They do not replace us."
        lede="A TMS solves hosted workflow, vendor management and delivery — none of which Palamedes does or intends to. The one thing worth checking before you sign is where each platform thinks the authoritative copy of a string lives, because that decides whether it sits on top of a repository-first toolchain or wants to become the toolchain. All of these read .po, which is the whole reason we write it."
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse border border-hair">
            <thead>
              <tr>
                <th className="micro border border-hair px-4 py-3 text-left text-[10.5px] tracking-th text-ink">
                  Platform
                </th>
                <th className="micro border border-hair px-4 py-3 text-left text-[10.5px] tracking-th text-gray-spec">
                  Ownership
                </th>
                <th className="micro border border-hair px-4 py-3 text-left text-[10.5px] tracking-th text-gray-spec">
                  Source of truth
                </th>
                <th className="micro border border-hair px-4 py-3 text-left text-[10.5px] tracking-th text-gray-spec">
                  .po handover
                </th>
              </tr>
            </thead>
            <tbody>
              {PLATFORMS.map((platform) => (
                <tr key={platform.name}>
                  <th
                    scope="row"
                    className="border border-hair px-4 py-3 text-left align-top text-[12.5px] font-bold"
                  >
                    {platform.name}
                    <span className="mt-1.5 block text-[12px] font-normal text-ink/85">
                      {platform.note}
                    </span>
                  </th>
                  <td className="border border-hair px-4 py-3 align-top text-[13px]">
                    {platform.owner}
                  </td>
                  <td className="border border-hair px-4 py-3 align-top text-[13px]">
                    {platform.truth}
                  </td>
                  <td className="border border-hair px-4 py-3 align-top text-[13px]">
                    {platform.po}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mono-nums mt-3 text-[11px] text-gray-spec">
          Researched {PLATFORMS_RESEARCHED}. Platforms change ownership and pricing often — re-check
          before you sign anything.
        </p>
        <p className="mt-6 max-w-[52em] text-[13.5px] leading-relaxed text-ink/85">
          Two of these ship a developer SDK rather than only a platform, so they get a full
          comparison of their own:{" "}
          <Link to="/compare/general-translation" viewTransition className="text-accent">
            General Translation
          </Link>{" "}
          and{" "}
          <Link to="/compare/tolgee" viewTransition className="text-accent">
            Tolgee
          </Link>
          .
        </p>
      </Section>

      <Section
        num="04 — Follow the money"
        title="Who is paying for your i18n library?"
        lede="This is the least discussed thing about this field and one of the more useful. Nearly every actively-funded JavaScript i18n library is either sponsored by translation vendors or built by one. None of that is hidden — every figure below comes from a public funding page — and none of it makes those libraries bad. It does mean the people paying for the roadmap mostly sell translation platforms, and that is worth knowing before you assume the defaults were chosen with only your interests in mind."
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse border border-hair">
            <thead>
              <tr>
                <th className="micro border border-hair px-4 py-3 text-left text-[10.5px] tracking-th text-ink">
                  Project
                </th>
                <th className="micro border border-hair px-4 py-3 text-left text-[10.5px] tracking-th text-gray-spec">
                  Who pays for the work
                </th>
                <th className="micro border border-hair px-4 py-3 text-left text-[10.5px] tracking-th text-gray-spec">
                  What they sell
                </th>
              </tr>
            </thead>
            <tbody>
              {FUNDING.map((row) => {
                const isUs = row.project === "Palamedes"
                return (
                  <tr key={row.project}>
                    <th
                      scope="row"
                      className={`border border-hair px-4 py-3 text-left align-top text-[12.5px] font-bold ${
                        isUs ? "border-l-2 border-l-accent bg-hover-fill text-accent" : ""
                      }`}
                    >
                      {row.project}
                    </th>
                    <td
                      className={`border border-hair px-4 py-3 align-top text-[13px] ${
                        isUs ? "bg-hover-fill" : ""
                      }`}
                    >
                      {row.funder}
                    </td>
                    <td
                      className={`border border-hair px-4 py-3 align-top text-[13px] ${
                        isUs ? "bg-hover-fill" : ""
                      }`}
                    >
                      {row.sells}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="mono-nums mt-3 text-[11px] text-gray-spec">
          From each project&apos;s own public funding pages — GitHub Sponsors, Open Collective,
          company disclosures — checked July 2026. Sponsorships change; re-check before you quote
          this.
        </p>

        <div className="mt-8 max-w-[60em] border-l-4 border-accent bg-hover-fill px-6 py-6">
          <p className="micro text-[10px] tracking-label text-gray-spec">Our own disclosure</p>
          <h3 className="mt-2 text-[15px] font-bold">
            We are not neutral either, and here is exactly how.
          </h3>
          <p className="mt-3 text-[13.5px] leading-relaxed text-ink/85">
            Palamedes is built by Sebastian Software, a company. Palamedes+ is planned as an
            optional managed layer for translation automation and collaboration. Making the argument
            above without saying that would be the kind of thing the rest of these pages exist to
            avoid. The open-source Palamedes toolchain remains the local foundation for authoring,
            extraction, catalogs, validation, and runtime integration.
          </p>
          <p className="mt-3 text-[13.5px] leading-relaxed text-ink/85">
            What you should hold us to is the architecture, not the plan. Palamedes does not require
            Palamedes+: your catalogs stay in your repository, the local toolchain needs no account,
            and the core remains MIT-licensed. If a commercial product ever depended on making that
            local foundation less useful on its own, the architecture would have to change first —
            and you would see the commit.
          </p>
          <a href={decisionHref()} className="mono-nums mt-4 inline-block text-[13px] text-accent">
            Read the decision records →
          </a>
        </div>
      </Section>

      <Section
        num="05 — Not a competitor"
        title="A machine-translation step is not an alternative to this."
        lede="A growing class of tools translates localization files in CI: point them at your catalogs, they call a model, they commit the result back as a pull request. They are worth knowing about, and they are not alternatives to Palamedes — they have no runtime, no message identity and no catalog semantics. They assume something upstream already produced well-formed catalogs."
      >
        <div className="hairline-grid grid-cols-2 max-tight:grid-cols-1">
          <div className="bg-paper px-6 py-6">
            <h3 className="text-[15px] font-bold">That upstream part is us</h3>
            <p className="mt-2 text-[13.5px] leading-relaxed text-ink/85">
              Palamedes extracts your source strings, resolves identity across refactors, merges
              semantically and validates the ICU. What a translation step receives is only as good
              as what produced it — and if the catalog is wrong, translating it faithfully makes it
              wrong in more languages.
            </p>
          </div>
          <div className="bg-paper px-6 py-6">
            <h3 className="text-[15px] font-bold">.po is why they compose</h3>
            <p className="mt-2 text-[13.5px] leading-relaxed text-ink/85">
              Most of these tools read gettext .po, which is exactly what Palamedes writes. Pick
              whichever one you like, or none — the repository stays the system of record either
              way, and nothing about your catalogs depends on that choice.
            </p>
          </div>
        </div>
      </Section>

      <Section
        num="06 — ICU semantics"
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
            We chose ICU anyway, for reasons we will defend: it is what the localization industry
            already speaks, what every TMS and CAT tool already processes, and what makes a .po file
            portable between vendors. Fluent&apos;s expressiveness is real, and it is paid for in a
            format only its own ecosystem reads. Practically, the choice is also narrower than it
            looks — <code>@fluent/react</code> has not been published since August 2023, and there
            is no server-components story. If your constraint is morphologically rich target
            languages and you have localization engineers to match, read their case rather than
            ours.
          </p>
        </div>
      </Section>

      <StatementBand num="07 — The honest bit">
        Every tool on these pages is good software, built by people who thought hard about the
        problem — and every one of them was designed against a JavaScript toolchain that has since
        been rebuilt underneath them. We started on the other side of that line. If our tradeoffs do
        not match your team, all {contentStats.adrCount} of them are written down, so you can find
        that out today rather than in month four.
      </StatementBand>

      <CtaBand
        headline="Judge it by the receipts, not the copy."
        primary={{ label: "See the proof", href: "/proof" }}
        secondary={{ label: "Try the 5-minute quickstart", href: "/get-started" }}
      />
    </Page>
  )
}
