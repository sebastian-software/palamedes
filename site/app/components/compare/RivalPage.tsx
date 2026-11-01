import { StructuredData } from "~/components/StructuredData";
import { faqStructuredData } from "~/lib/meta";
import { ButtonLink, EditorialRail, Page, Section } from "@palamedes/site-ui";
import { CtaBand } from "~/components/home/CtaBand";
import { PageHero } from "~/components/marketing/PageHero";
import { StatementBand } from "~/components/home/StatementBand";
import { BENCH_FOOTNOTE, type Rival, type RivalCode, type RivalRow } from "~/data/rivals";

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
  return code.split("\n").map((text, index) => ({ no: index + 1, text }));
}

function toneFor(line: string): string {
  if (line.startsWith("import ") || line.startsWith("export ")) return "text-slate";
  if (line.startsWith("//") || line.startsWith("#")) return "text-gray-spec";
  return "text-ink/90";
}

function CodePane({ label, code }: { label: string; code: string }) {
  return (
    /*
     * h-full + a growing <pre>: the two panes rarely have the same line count,
     * and without this the shorter one ends in a strip of paper below the dark
     * code block instead of matching its neighbour.
     */
    <div className="flex h-full flex-col bg-paper">
      <p className="micro border-b border-hair px-5 py-3 text-[11px] tracking-label text-gray-spec">
        {label}
      </p>
      <pre
        className="pmds-code grow overflow-x-auto border-0 px-5 py-4 font-mono text-[12.5px] leading-[1.7] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent"
        tabIndex={0}
      >
        {toLines(code).map((line) => (
          <div key={line.no} className={toneFor(line.text)}>
            {line.text || " "}
          </div>
        ))}
      </pre>
    </div>
  );
}

function CodeCompare({ code }: { code: RivalCode }) {
  return (
    <div>
      <div className="hairline-grid grid-cols-2 max-tight:grid-cols-1">
        <CodePane label={code.rivalLabel} code={code.rivalCode} />
        <CodePane label={code.palamedesLabel} code={code.palamedesCode} />
      </div>
      {code.note ? (
        <p className="mt-4 max-w-[52em] text-[15.5px] leading-relaxed text-ink/85">{code.note}</p>
      ) : null}
    </div>
  );
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
            <th className="micro border border-hair border-l-2 border-l-accent bg-hover-fill px-4 py-3 text-left text-[10px] tracking-th text-ink">
              Palamedes
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.criterion}>
              <th
                scope="row"
                className="border border-hair px-4 py-3 text-left align-top text-[14px] font-bold"
              >
                {row.criterion}
              </th>
              <td className="border border-hair px-4 py-3 align-top text-[14.5px]">{row.rival}</td>
              <td className="border border-hair border-l-2 border-l-accent bg-hover-fill px-4 py-3 align-top text-[14.5px]">
                {row.palamedes}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
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
  label: string;
  title: string;
  items: string[];
  accent?: boolean;
}) {
  return (
    <div className="bg-paper px-7 py-7">
      <p className="micro text-[11px] tracking-label text-gray-spec">{label}</p>
      <h3 className={`mt-2 text-[15px] font-bold ${accent ? "text-accent" : ""}`}>{title}</h3>
      <ul className="mt-4 space-y-3">
        {items.map((item) => (
          <li key={item} className="flex gap-2.5 text-[15.5px] leading-relaxed text-ink/85">
            <span aria-hidden className={`mono-nums ${accent ? "text-accent" : "text-gray-spec"}`}>
              ·
            </span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PickList({ title, items, accent }: { title: string; items: string[]; accent?: boolean }) {
  return (
    <div className="bg-paper px-7 py-7">
      <h3 className={`text-[15px] font-bold ${accent ? "text-accent" : ""}`}>{title}</h3>
      <ul className="mt-3 space-y-2">
        {items.map((item) => (
          <li key={item} className="flex gap-2 text-[15.5px] leading-relaxed text-ink/85">
            <span aria-hidden className="mono-nums text-accent">
              ·
            </span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function RivalFaq({ rival }: { rival: Rival }) {
  return (
    /* See HomeFaq: the site guard counts the entries inside this list. */
    <div className="max-w-[56rem] border-t border-hair" data-faq-list>
      {rival.faq.map((entry) => (
        <details key={entry.q} className="group border-b border-hair">
          <summary className="flex cursor-pointer list-none items-start justify-between gap-6 py-6 text-[18px] leading-snug font-semibold marker:content-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent [&::-webkit-details-marker]:hidden">
            <span>{entry.q}</span>
            <span
              aria-hidden
              className="grid size-8 shrink-0 place-items-center border border-hair text-[18px] font-normal text-accent transition-transform group-open:rotate-45"
            >
              +
            </span>
          </summary>
          <p className="max-w-[46rem] pb-7 text-[16px] leading-relaxed text-ink/80">{entry.a}</p>
        </details>
      ))}
    </div>
  );
}

export function RivalPage({ rival }: { rival: Rival }) {
  const usesBenchmark = rival.rows.some((row) => row.palamedes.includes("¹"));
  /*
   * Column count follows the item count so the hairline grid never ends on a
   * half-empty row: three differences read best as thirds, four as halves.
   */
  const differenceCols = rival.differences.length % 3 === 0 ? "grid-cols-3" : "grid-cols-2";

  return (
    <Page>
      <StructuredData data={faqStructuredData(rival.faq)} />
      <PageHero
        kicker={rival.eyebrow}
        title={rival.headline}
        lede={rival.lede}
        actions={
          <>
            <ButtonLink href={rival.evaluation.href}>{rival.evaluation.label}</ButtonLink>
            <ButtonLink variant="outline" href="#decide">
              See the decision summary
            </ButtonLink>
          </>
        }
        aside={
          <div className="border border-ink bg-paper px-7 py-7">
            <p className="micro text-[11px] tracking-label text-accent">Our recommendation</p>
            <p className="mt-4 text-[17px] leading-relaxed">{rival.thesis}</p>
            <p className="mt-5 border-t border-hair pt-4 text-[14px] leading-relaxed text-ink/70">
              For {rival.audience}
            </p>
          </div>
        }
      />
      <div className="pmds-measured pb-[clamp(3.5rem,6vw,5.5rem)]">
        <dl className="grid grid-cols-4 gap-px border border-hair bg-hair max-grid:grid-cols-2 max-tight:grid-cols-1">
          {rival.facts.map((fact) => (
            <div key={fact.label} className="bg-paper px-5 py-5">
              <dt className="micro text-[11px] tracking-label text-gray-spec">{fact.label}</dt>
              <dd className="mono-nums mt-2 text-[15px]">{fact.value}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-[13px] text-gray-spec">
          {rival.name} figures: {rival.subject}, researched {rival.researched}. Projects move;
          re-check before you decide.
        </p>
      </div>

      <Section
        num="01 — Decide"
        id="decide"
        title="Choose the model that leaves you with less recurring work."
        lede={`For the audience above, we recommend Palamedes. The alternative is not a disclaimer: if the right column describes your constraint, choose ${rival.name} and do not think twice about it.`}
      >
        <div className="hairline-grid grid-cols-2 max-tight:grid-cols-1">
          <PickList title="Pick Palamedes when…" items={rival.pickPalamedes} accent />
          <PickList title={`Pick ${rival.name} when…`} items={rival.pickRival} />
        </div>
        {rival.migration ? (
          <EditorialRail tone="emphasis" className="mt-8">
            <p className="micro text-[10px] text-gray-spec">Coming from {rival.name}?</p>
            <p className="mt-1 text-[15.5px] leading-relaxed">{rival.migration.body}</p>
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
        num="02 — Daily work"
        title="What changes after the choice is made."
        lede="These are workflow consequences, not a feature inventory: fewer conventions to maintain, one catalog boundary to review, and one runtime model to carry through the supported hosts. Each point maps back to an inspectable artifact."
      >
        <div
          className={`hairline-grid ${differenceCols} max-grid:grid-cols-2 max-tight:grid-cols-1`}
        >
          {rival.differences.map((difference) => (
            <div key={difference.title} className="bg-paper px-6 py-6">
              <h3 className="text-[18px] leading-snug font-bold">{difference.title}</h3>
              <p className="mt-2 text-[15.5px] leading-relaxed text-ink/85">{difference.body}</p>
              <a
                href={rival.outcomeProof.href}
                className="mono-nums mt-4 inline-block text-[12px] text-accent hover:underline"
              >
                {rival.outcomeProof.label} →
              </a>
            </div>
          ))}
        </div>
      </Section>

      <Section
        num={`03 — ${rival.name}`}
        title="Where the competitor is the stronger fit."
        lede={`The strengths and trade-offs below are sourced from the dated research for ${rival.name}. They explain why the right decision can genuinely be ${rival.name}, even when Palamedes is our recommendation for the audience above.`}
      >
        <div className="hairline-grid grid-cols-2 max-tight:grid-cols-1">
          <LedgerColumn
            label="Competitor strength"
            title={rival.respectTitle}
            items={rival.respect}
          />
          <LedgerColumn
            label="Trade-off"
            title={rival.flipsideTitle}
            items={rival.flipside}
            accent
          />
        </div>
      </Section>

      <Section num="04 — Proof in code" title={rival.code.caption}>
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

      <StatementBand num="06 — The trade-off">{rival.honest}</StatementBand>

      <Section num="07 — Evaluate" title={rival.evaluation.title} lede={rival.evaluation.body}>
        <div className="flex flex-wrap gap-3">
          <ButtonLink href={rival.evaluation.href}>{rival.evaluation.label}</ButtonLink>
          <ButtonLink variant="outline" href={rival.outcomeProof.href}>
            {rival.outcomeProof.label}
          </ButtonLink>
        </div>
      </Section>

      <Section
        num="08 — Questions"
        id="faq"
        title={`Questions teams ask before leaving ${rival.name}.`}
        lede="The migration, framework, catalog, runtime and trade-off boundaries are stated here and included in the page's structured data."
      >
        <RivalFaq rival={rival} />
      </Section>

      <CtaBand
        headline="Make the next step match the decision you still need to make."
        primary={{ label: rival.evaluation.label, href: rival.evaluation.href }}
        secondary={{ label: "Compare another model", href: "/compare" }}
      />
    </Page>
  );
}
