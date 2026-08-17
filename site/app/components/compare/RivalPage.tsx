import { ButtonLink, EditorialRail, Page, Section } from "@palamedes/site-ui"
import { CtaBand } from "~/components/home/CtaBand"
import { StatementBand } from "~/components/home/StatementBand"
import { BENCH_FOOTNOTE, type Rival, type RivalCode, type RivalRow } from "~/data/rivals"

/*
 * One layout for every /compare/* page, driven by data/rivals.ts.
 *
 * The section order is the argument. The thesis lands immediately under the
 * hero, because a comparison page that buries its position is not selling
 * anything. Section 01 is the verdict: the reader gets an honest decision
 * before any supporting detail. The sourced credit / cost pair, differences,
 * code, and measured table then make that verdict inspectable.
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
      <p className="micro border-b border-hair px-5 py-3 text-[10px] tracking-label text-gray-spec">
        {label}
      </p>
      <pre
        className="grow overflow-x-auto bg-ink px-5 py-4 font-mono text-[12.5px] leading-[1.7] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-paper"
        tabIndex={0}
      >
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
    <div
      className="overflow-x-auto focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent"
      tabIndex={0}
      aria-label="Comparison table"
    >
      <table className="w-full min-w-[720px] border-collapse border border-hair">
        <thead>
          <tr>
            <th className="micro border border-hair px-4 py-3 text-left text-[10px] tracking-th text-gray-spec">
              Criteria
            </th>
            <th className="micro border border-hair px-4 py-3 text-left text-[10px] tracking-th text-ink">
              {rival}
            </th>
            <th className="micro border border-hair border-l-2 border-l-accent bg-hover-fill px-4 py-3 text-left text-[10px] tracking-th text-accent">
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

/*
 * The credit / cost pair. Same visual weight on both columns on purpose — the
 * page loses its nerve if the strengths look like a disclaimer, and loses its
 * credibility if the costs look like the main event.
 */
function LedgerColumn({
  label,
  title,
  items,
  accent,
}: {
  label: string
  title: string
  items: string[]
  accent?: boolean
}) {
  return (
    <div className="bg-paper px-6 py-6">
      <p className="micro text-[10px] tracking-label text-gray-spec">{label}</p>
      <h3 className={`mt-2 text-[15px] font-bold ${accent ? "text-accent" : ""}`}>{title}</h3>
      <ul className="mt-4 space-y-3">
        {items.map((item) => (
          <li key={item} className="flex gap-2.5 text-[13.5px] leading-relaxed text-ink/85">
            <span aria-hidden className={`mono-nums ${accent ? "text-accent" : "text-gray-spec"}`}>
              ·
            </span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
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
        <EditorialRail tone="emphasis" className="mt-12 bg-hover-fill py-6 pr-6">
          <p className="micro text-[10px] tracking-label text-gray-spec">Our position</p>
          <p className="mt-3 max-w-[46em] text-[16px] leading-relaxed">{rival.thesis}</p>
        </EditorialRail>
      </section>

      <Section
        num="01 — Decide"
        id="decide"
        title="Which one should you actually pick?"
        lede={`We think most React and Solid teams are better off here, and the left column says why. The right column is not a disclaimer — if it describes your situation, use ${rival.name} and do not think twice about it.`}
      >
        <div className="hairline-grid grid-cols-2 max-tight:grid-cols-1">
          <PickList title="Pick Palamedes when…" items={rival.pickPalamedes} accent />
          <PickList title={`Pick ${rival.name} when…`} items={rival.pickRival} />
        </div>
        {rival.migration ? (
          <EditorialRail tone="emphasis" className="mt-8">
            <p className="micro text-[10px] text-gray-spec">Coming from {rival.name}?</p>
            <p className="mt-1 text-[13.5px] leading-relaxed">{rival.migration.body}</p>
            <a
              href={rival.migration.href}
              className="mono-nums mt-3 inline-block text-[13px] text-accent"
            >
              {rival.migration.label} →
            </a>
          </EditorialRail>
        ) : null}
      </Section>

      <Section
        num={`02 — ${rival.name}`}
        title="Credit where it is due, and what it costs."
        lede={`Every strength is a decision, and every decision has a price someone pays. Here is ${rival.name} at its strongest — and the bill that comes with it. Both columns are sourced from the research notes, not from our marketing department.`}
      >
        <div className="hairline-grid grid-cols-2 max-tight:grid-cols-1">
          <LedgerColumn label="Credit" title={rival.respectTitle} items={rival.respect} />
          <LedgerColumn
            label="The flipside"
            title={rival.flipsideTitle}
            items={rival.flipside}
            accent
          />
        </div>
      </Section>

      <Section
        num="03 — Difference"
        title="Why Palamedes is built the way it is"
        lede="Not a feature list — the handful of decisions that actually change how the two feel in daily work, and the reasoning behind each one."
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

      <Section num="04 — Code" title={rival.code.caption}>
        <CodeCompare code={rival.code} />
      </Section>

      <Section
        num="05 — Side by side"
        title="The comparison, without the adjectives."
        lede="Where a row cites a measurement, it comes from the checked benchmark report in the repository. Where nothing was measured, the row says so."
      >
        <RivalMatrix rival={rival.name} rows={rival.rows} />
        {usesBenchmark ? (
          <p className="mono-nums mt-3 max-w-[60em] text-[11px] text-gray-spec">{BENCH_FOOTNOTE}</p>
        ) : null}
      </Section>

      <StatementBand num="06 — The honest bit">{rival.honest}</StatementBand>

      <CtaBand
        headline="Check the receipts before you believe the page."
        primary={{ label: "See the proof", href: "/proof" }}
        secondary={{ label: "Compare the others", href: "/compare" }}
      />
    </Page>
  )
}
