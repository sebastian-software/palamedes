import { ButtonLink } from "~/components/chrome/Button"
import { Page } from "~/components/chrome/Page"
import { pageMeta } from "~/lib/meta"
import { Section } from "~/components/chrome/Section"
import { CtaBand } from "~/components/home/CtaBand"
import { StatementBand } from "~/components/home/StatementBand"
import { COMPARE_CRITERIA, COMPARE_FOOTNOTES, COMPARE_TOOLS } from "~/data/compare"
import { docsHref } from "~/data/links"

export const handle = { layout: "bare" }

export function meta() {
  return pageMeta({
    title: "Palamedes vs Lingui, next-intl, and General Translation — an honest comparison",
    description:
      "How Palamedes compares with Lingui, next-intl, and General Translation — including when you should pick the other tool.",
    path: "/compare",
  })
}

function CompareTable() {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] border-collapse border border-hair">
        <thead>
          <tr>
            <th className="micro border border-hair px-4 py-3 text-left text-[10.5px] tracking-th text-gray-spec">
              Criteria
            </th>
            {COMPARE_TOOLS.map((tool) => (
              <th
                key={tool.name}
                className={`micro border border-hair px-4 py-3 text-left text-[10.5px] tracking-th ${
                  tool.accent ? "border-l-2 border-l-accent bg-hover-fill text-accent" : "text-ink"
                }`}
              >
                {tool.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {COMPARE_CRITERIA.map((criterion, rowIndex) => (
            <tr key={criterion}>
              <th
                scope="row"
                className="border border-hair px-4 py-3 text-left align-top text-[12.5px] font-bold"
              >
                {criterion}
              </th>
              {COMPARE_TOOLS.map((tool) => (
                <td
                  key={tool.name}
                  className={`border border-hair px-4 py-3 align-top text-[13px] ${
                    tool.accent ? "border-l-2 border-l-accent bg-hover-fill" : ""
                  }`}
                >
                  {tool.cells[rowIndex]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {COMPARE_FOOTNOTES.map((footnote) => (
        <p key={footnote} className="mono-nums mt-3 text-[11px] text-gray-spec">
          {footnote}
        </p>
      ))}
    </div>
  )
}

export default function Compare() {
  return (
    <Page>
      <section className="px-8 pt-16 pb-14 max-tight:px-5">
        <p className="eyebrow">Comparison</p>
        <h1 className="mt-6 max-w-[12em] text-display leading-[0.98] font-bold tracking-[-0.03em] text-balance">
          Narrower than the alternatives. On&nbsp;purpose.
        </h1>
        <p className="mt-6 max-w-[38em]">
          Palamedes is for teams that like compile-time authoring and want the stack under it to
          feel smaller, steadier, and easier to trust. Here is how that compares — including when
          you should pick something else.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <ButtonLink href="#lingui">Compare with Lingui</ButtonLink>
          <ButtonLink variant="outline" href="/proof">
            See the proof
          </ButtonLink>
        </div>
      </section>

      <Section
        num="01 — Lingui"
        title="Palamedes vs Lingui"
        id="lingui"
        lede="Lingui is the closest neighbor — same authoring instinct, same source-string-first heart. Palamedes is the stricter end state of that idea: one runtime model instead of several entry points, one native engine for catalogs instead of plugin layers, and adapters that stay thin."
      >
        <CompareTable />
        <div className="mt-8 max-w-[56em] border-l-4 border-accent pl-4">
          <p className="micro text-[10px] text-gray-spec">Honest note</p>
          <p className="mt-1 text-[13.5px]">
            Pick Lingui if you need its ecosystem breadth or plugins Palamedes doesn't have yet.
            Migrating anyway? Existing source-string-first .po catalogs are often reusable after an
            extraction pass; explicit-ID-heavy projects need cleanup — the playbook covers both
            paths.
          </p>
        </div>
        <div className="mt-6 space-y-2">
          <a
            href={docsHref("comparison-with-lingui")}
            className="mono-nums block text-[13px] text-accent"
          >
            Detailed comparison →
          </a>
          <a
            href={docsHref("migrate-from-lingui")}
            className="mono-nums block text-[13px] text-accent"
          >
            Migration playbook →
          </a>
        </div>
      </Section>

      <Section
        num="02 — next-intl"
        title="Palamedes vs next-intl"
        lede="Different mental model, both valid. next-intl centers on message files with keys and is deeply Next.js-native. Palamedes centers on source strings in your components and stays framework-portable."
      >
        <div className="hairline-grid grid-cols-2 max-tight:grid-cols-1">
          <div className="bg-paper px-6 py-6">
            <h3 className="text-[15px] font-bold">Pick next-intl when…</h3>
            <p className="mt-2 text-[13.5px] leading-relaxed text-ink/85">
              You are all-in on Next.js, prefer key-based message files as the source of truth, and
              want the most Next-idiomatic API.
            </p>
          </div>
          <div className="bg-paper px-6 py-6">
            <h3 className="text-[15px] font-bold">Pick Palamedes when…</h3>
            <p className="mt-2 text-[13.5px] leading-relaxed text-ink/85">
              You write messages in code, want .po catalogs translators already know, or expect to
              outlive your current framework choice.
            </p>
          </div>
        </div>
      </Section>

      <Section
        num="03 — General Translation"
        title="Palamedes vs General Translation"
        lede="A category difference, not a feature race. GT is a translation platform — hosted workflows, AI translation, delivery. Palamedes is local-first tooling: your repo owns the catalogs, the QA, and the history. The two concerns can even stack: Palamedes as the local foundation, a service layer on top."
      />

      <StatementBand num="04 — The honest bit">
        Every tool on this page is good software. The question is which tradeoffs match your team —
        ours are written down in 16 ADRs, so you can check before you commit.
      </StatementBand>

      <CtaBand
        headline="Judge it by the receipts, not the copy."
        primary={{ label: "See the proof", href: "/proof" }}
        secondary={{ label: "Try the 5-minute quickstart", href: "/get-started" }}
      />
    </Page>
  )
}
