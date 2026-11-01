import { ArdoLink as Link } from "ardo/runtime";

import { ButtonLink, EditorialRail, Page, Section } from "@palamedes/site-ui";
import { PageHero } from "~/components/marketing/PageHero";
import { pageMeta } from "~/lib/meta";
import { CtaBand } from "~/components/home/CtaBand";
import { StatementBand } from "~/components/home/StatementBand";
import contentStats from "~/data/generated/content-stats.json";
import { REPO, decisionHref, docsHref } from "~/data/links";
import { NOT_FOR_YOU } from "~/data/fit";
import { NATIVE_SHIFT, RIVALS } from "~/data/rivals";

export const handle = { layout: "bare" };

export function meta() {
  return pageMeta({
    title:
      "Palamedes compared — Lingui, fbtee, i18next, next-intl, React Intl, Paraglide, Intlayer, Tolgee",
    description: `Choose an i18n model that stays coherent as a TypeScript application grows. Compare Palamedes with ${RIVALS.length} alternatives through explicit recommendations, dated research, checked workflow evidence and honest exits.`,
    path: "/compare",
  });
}

function measuredWorkflow(rival: (typeof RIVALS)[number]) {
  return rival.rows.find((row) => row.palamedes.includes("¹"));
}

export default function Compare() {
  return (
    <Page>
      <PageHero
        kicker="Compare"
        title="Choose the i18n model you can keep."
        lede={`Every i18n library makes a bet: where your text lives, who keeps it in sync, and what runs in the browser. Here is how Palamedes compares with ${RIVALS.length} alternatives — including the cases where another tool is the better choice.`}
        actions={
          <>
            <ButtonLink href="/compare/lingui">Compare the closest model: Lingui</ButtonLink>
            <ButtonLink variant="outline" href="/proof">
              Inspect the workflow proof
            </ButtonLink>
          </>
        }
        aside={
          <div className="border border-ink bg-paper px-7 py-7">
            <p className="micro text-[11px] tracking-label text-accent">Decision frame</p>
            <h2 className="mt-3 text-[21px] leading-snug font-bold tracking-[-0.01em]">
              {NATIVE_SHIFT.title}
            </h2>
            <p className="mt-3 text-[15.5px] leading-relaxed text-ink/85">{NATIVE_SHIFT.body}</p>
          </div>
        }
      >
        <p className="mt-7 max-w-[40rem] text-[14px] leading-relaxed text-ink/75">
          For React and Solid teams that want source strings, repository-owned PO catalogs, and one
          runtime model across supported hosts, Palamedes is the more durable default. That is a
          recommendation, not a claim that every alternative loses: measured results stay separate
          from dated research.
        </p>
      </PageHero>

      <Section
        num="01 — Comparison ledger"
        id="comparison-ledger"
        title="What we measured, what we researched, and where we made no claim."
        lede={`${RIVALS.length} libraries, ${RIVALS.length} decisions. Start with the recommendation that fits your current architecture, then use this ledger to verify the evidence boundary. An empty measurement is an explicit boundary, not a footnote.`}
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse border border-hair">
            <caption className="sr-only">
              Comparison ledger, separating direct workflow measurements from dated research.
            </caption>
            <thead>
              <tr>
                <th className="micro border border-hair px-4 py-3 text-left text-[10px] tracking-th text-gray-spec">
                  Comparison
                </th>
                <th className="micro border border-hair px-4 py-3 text-left text-[10px] tracking-th text-accent">
                  Measured
                </th>
                <th className="micro border border-hair px-4 py-3 text-left text-[10px] tracking-th text-gray-spec">
                  Researched
                </th>
                <th className="micro border border-hair px-4 py-3 text-left text-[10px] tracking-th text-gray-spec">
                  Detail
                </th>
              </tr>
            </thead>
            <tbody>
              {RIVALS.map((rival) => {
                const measurement = measuredWorkflow(rival);
                return (
                  <tr key={rival.slug}>
                    <th scope="row" className="border border-hair px-4 py-4 text-left align-top">
                      <p className="text-[16px] font-bold">Palamedes vs {rival.name}</p>
                      <p className="mt-1 text-[12.5px] leading-relaxed text-ink/75">{rival.card}</p>
                    </th>
                    <td className="border border-hair bg-hover-fill px-4 py-4 align-top text-[13px] leading-relaxed">
                      {measurement ? (
                        <>
                          <p className="font-bold text-ink">{measurement.palamedes}</p>
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
                        className="mono-nums text-[13px] text-accent hover:underline"
                      >
                        Read decision →
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <EditorialRail tone="emphasis" className="mt-8 bg-hover-fill py-5 pr-6">
          <h3 className="text-[18px] font-bold">Weighing something not listed here?</h3>
          <p className="mt-2 max-w-[52em] text-[15.5px] leading-relaxed text-ink/85">
            These cover the libraries most teams actually shortlist. If yours is missing, open an
            issue with the comparison you need — every page here is backed by a dated research note
            in the repository, and we would rather write one than guess.
          </p>
          <a
            href={`${REPO}/issues`}
            className="micro mt-3 inline-block text-[12px] text-ink underline decoration-accent underline-offset-4 hover:text-accent"
          >
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
              <h3 className="text-[18px] font-bold">{entry.case}</h3>
              <p className="mt-2 text-[15.5px] leading-relaxed text-ink/85">{entry.answer}</p>
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
            <h3 className="text-[18px] font-bold">What we prove</h3>
            <p className="mt-2 text-[15.5px] leading-relaxed text-ink/85">
              One checked fixture exercises nested select and plural branches across extraction,
              transformation, catalog update, compilation, and six executions of the transformed
              runtime function. You can re-run it yourself.
            </p>
          </div>
          <div className="bg-paper px-6 py-6">
            <h3 className="text-[18px] font-bold">What we only snapshot</h3>
            <p className="mt-2 text-[15.5px] leading-relaxed text-ink/85">
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
          <h3 className="mt-2 text-[18px] font-bold">
            Mozilla&apos;s Project Fluent thinks ICU is the wrong shape.
          </h3>
          <p className="mt-2 text-[15.5px] leading-relaxed text-ink/85">
            Fluent&apos;s case is worth stating properly, because it is the strongest one anybody
            makes. In ICU, the structure of a message is fixed by the source language: if English
            needs no gender agreement, the message has no gender selector, and a translator into a
            language that does need one cannot add it without a developer editing the source. Fluent
            inverts that — a translation may introduce selectors and grammatical machinery the
            original never had. It ships in Firefox, so this is proven at scale, not theoretical.
          </p>
          <p className="mt-3 text-[15.5px] leading-relaxed text-ink/85">
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
        headline="Start with the comparison that matches the risk you need to remove."
        primary={{ label: "Compare Palamedes with Lingui", href: "/compare/lingui" }}
        secondary={{
          label: "Run the guided evaluation setup",
          href: "/get-started",
        }}
      />
    </Page>
  );
}
