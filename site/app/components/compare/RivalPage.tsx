import { Link } from "react-router"

import { ButtonLink } from "~/components/chrome/Button"
import { Page } from "~/components/chrome/Page"
import { Section } from "~/components/chrome/Section"
import { CtaBand } from "~/components/home/CtaBand"
import { StatementBand } from "~/components/home/StatementBand"
import { BENCH_FOOTNOTE, RIVALS, type Rival, type RivalCode, type RivalRow } from "~/data/rivals"

/*
 * One layout for every /compare/* page, driven by data/rivals.ts.
 *
 * The section order is the argument: acknowledge what the other project is
 * good at first, then the differences, then code, then the table, then the
 * "pick the other one when…" list. A comparison that leads with its own
 * feature list reads like a pitch; this one earns the claims first.
 */

function toLines(code: string): { no: number; text: string }[] {
  return code.split("\n").map((text, index) => ({ no: index + 1, text }))
}

function toneFor(line: string): string {
  if (line.startsWith("import ") || line.startsWith("export ")) return "text-accent-soft"
  if (line.startsWith("//") || line.startsWith("#")) return "text-gray-spec"
  return "text-paper/85"
}

function CodePane({ label, code }: { label: string; code: string }) {
  return (
    /*
     * h-full + a growing <pre>: the two panes rarely have the same line count,
     * and without this the shorter one ends in a strip of paper below the dark
     * code block instead of matching its neighbour.
     */
    <div className="flex h-full flex-col bg-paper">
      <p className="micro border-b border-hair px-5 py-3 text-[10.5px] tracking-label text-gray-spec">
        {label}
      </p>
      <pre className="grow overflow-x-auto bg-ink px-5 py-4 font-mono text-[12.5px] leading-[1.7]">
        {toLines(code).map((line) => (
          <div key={line.no} className={toneFor(line.text)}>
            {line.text || " "}
          </div>
        ))}
      </pre>
    </div>
  )
}

function CodeCompare({ code }: { code: RivalCode }) {
  return (
    <div>
      <div className="hairline-grid grid-cols-2 max-tight:grid-cols-1">
        <CodePane label={code.rivalLabel} code={code.rivalCode} />
        <CodePane label={code.palamedesLabel} code={code.palamedesCode} />
      </div>
      {code.note ? (
        <p className="mt-4 max-w-[52em] text-[13.5px] leading-relaxed text-ink/85">{code.note}</p>
      ) : null}
    </div>
  )
}

function RivalMatrix({ rival, rows }: { rival: string; rows: RivalRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] border-collapse border border-hair">
        <thead>
          <tr>
            <th className="micro border border-hair px-4 py-3 text-left text-[10.5px] tracking-th text-gray-spec">
              Criteria
            </th>
            <th className="micro border border-hair px-4 py-3 text-left text-[10.5px] tracking-th text-ink">
              {rival}
            </th>
            <th className="micro border border-hair border-l-2 border-l-accent bg-hover-fill px-4 py-3 text-left text-[10.5px] tracking-th text-accent">
              Palamedes
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.criterion}>
              <th
                scope="row"
                className="border border-hair px-4 py-3 text-left align-top text-[12.5px] font-bold"
              >
                {row.criterion}
              </th>
              <td className="border border-hair px-4 py-3 align-top text-[13px]">{row.rival}</td>
              <td className="border border-hair border-l-2 border-l-accent bg-hover-fill px-4 py-3 align-top text-[13px]">
                {row.palamedes}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function PickList({ title, items, accent }: { title: string; items: string[]; accent?: boolean }) {
  return (
    <div className="bg-paper px-6 py-6">
      <h3 className={`text-[15px] font-bold ${accent ? "text-accent" : ""}`}>{title}</h3>
      <ul className="mt-3 space-y-2">
        {items.map((item) => (
          <li key={item} className="flex gap-2 text-[13.5px] leading-relaxed text-ink/85">
            <span aria-hidden className="mono-nums text-accent">
              ·
            </span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function RivalPage({ rival }: { rival: Rival }) {
  const usesBenchmark = rival.rows.some((row) => row.palamedes.includes("¹"))
  /*
   * Column count follows the item count so the hairline grid never ends on a
   * half-empty row: three differences read best as thirds, four as halves.
   */
  const differenceCols = rival.differences.length % 3 === 0 ? "grid-cols-3" : "grid-cols-2"

  return (
    <Page>
      <section className="px-8 pt-16 pb-14 max-tight:px-5">
        <p className="eyebrow">{rival.eyebrow}</p>
        <h1 className="mt-6 max-w-[13em] text-display leading-[0.98] font-bold tracking-[-0.03em] text-balance">
          {rival.headline}
        </h1>
        <p className="mt-6 max-w-[40em]">{rival.lede}</p>

        <dl className="mt-10 grid grid-cols-4 gap-px border border-hair bg-hair max-grid:grid-cols-2 max-tight:grid-cols-1">
          {rival.facts.map((fact) => (
            <div key={fact.label} className="bg-paper px-4 py-4">
              <dt className="micro text-[10px] tracking-label text-gray-spec">{fact.label}</dt>
              <dd className="mono-nums mt-1 text-[13.5px]">{fact.value}</dd>
            </div>
          ))}
        </dl>
        <p className="mono-nums mt-3 text-[11px] text-gray-spec">
          {rival.name} figures: {rival.subject}, researched {rival.researched}. Projects move;
          re-check before you decide.
        </p>

        <div className="mt-8 flex flex-wrap gap-3">
          <ButtonLink href="/get-started">Try the 5-minute quickstart</ButtonLink>
          <ButtonLink variant="outline" href="#decide">
            Which should you pick?
          </ButtonLink>
        </div>
      </section>

      <Section
        num={`01 — ${rival.name}`}
        title={rival.respectTitle}
        lede={`No comparison is worth reading if it cannot say what the other side is good at. Here is ${rival.name} at its strongest, in its own terms.`}
      >
        <ul className="hairline-grid grid-cols-2 max-tight:grid-cols-1">
          {rival.respect.map((item) => (
            <li key={item} className="bg-paper px-6 py-5 text-[13.5px] leading-relaxed text-ink/85">
              {item}
            </li>
          ))}
        </ul>
      </Section>

      <Section
        num="02 — Difference"
        title="Where Palamedes takes a different position"
        lede="Not a feature list — the handful of decisions that actually change how the two feel in daily work."
      >
        <div
          className={`hairline-grid ${differenceCols} max-grid:grid-cols-2 max-tight:grid-cols-1`}
        >
          {rival.differences.map((difference) => (
            <div key={difference.title} className="bg-paper px-6 py-6">
              <h3 className="text-[15px] font-bold">{difference.title}</h3>
              <p className="mt-2 text-[13.5px] leading-relaxed text-ink/85">{difference.body}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section num="03 — Code" title={rival.code.caption}>
        <CodeCompare code={rival.code} />
      </Section>

      <Section
        num="04 — Side by side"
        title="The comparison, without the adjectives."
        lede="Where a row cites a measurement, it comes from the checked benchmark report in the repository. Where nothing was measured, the row says so."
      >
        <RivalMatrix rival={rival.name} rows={rival.rows} />
        {usesBenchmark ? (
          <p className="mono-nums mt-3 max-w-[60em] text-[11px] text-gray-spec">{BENCH_FOOTNOTE}</p>
        ) : null}
      </Section>

      <Section
        num="05 — Decide"
        id="decide"
        title="Which one should you actually pick?"
        lede="If the left column describes your situation, use the other tool. We would rather you ship the right thing than pick ours."
      >
        <div className="hairline-grid grid-cols-2 max-tight:grid-cols-1">
          <PickList title={`Pick ${rival.name} when…`} items={rival.pickRival} />
          <PickList title="Pick Palamedes when…" items={rival.pickPalamedes} accent />
        </div>
        {rival.migration ? (
          <div className="mt-8 max-w-[56em] border-l-4 border-accent pl-4">
            <p className="micro text-[10px] text-gray-spec">Coming from {rival.name}?</p>
            <p className="mt-1 text-[13.5px] leading-relaxed">{rival.migration.body}</p>
            <a
              href={rival.migration.href}
              className="mono-nums mt-3 inline-block text-[13px] text-accent"
            >
              {rival.migration.label} →
            </a>
          </div>
        ) : null}
      </Section>

      <StatementBand num="06 — The honest bit">{rival.honest}</StatementBand>

      <Section num="07 — Also weighing" title="Comparing something else?">
        <div className="hairline-grid grid-cols-4 max-grid:grid-cols-2 max-tight:grid-cols-1">
          {RIVALS.filter((other) => other.slug !== rival.slug).map((other) => (
            <Link
              key={other.slug}
              to={`/compare/${other.slug}`}
              viewTransition
              className="group bg-paper px-5 py-5 transition-colors hover:bg-hover-fill"
            >
              <p className="micro text-[10px] tracking-label text-gray-spec">Palamedes vs</p>
              <p className="mt-2 text-[15px] font-bold group-hover:text-accent">{other.name}</p>
              <p className="mt-2 text-[12.5px] leading-relaxed text-ink/85">{other.card}</p>
            </Link>
          ))}
        </div>
      </Section>

      <CtaBand
        headline="Check the receipts before you believe the page."
        primary={{ label: "See the proof", href: "/proof" }}
        secondary={{ label: "Compare the others", href: "/compare" }}
      />
    </Page>
  )
}
