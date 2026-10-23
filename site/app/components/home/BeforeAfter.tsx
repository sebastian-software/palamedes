import { Reveal } from "@palamedes/site-ui";

import { Band, BandHeader } from "~/components/marketing/Band";
import { BENCH_REALISTIC, displayBenchmarkTime } from "~/data/bench";
import { blacksmithBench } from "~/data/blacksmith-bench";

/*
 * The chooser's first question: what actually changes? Each row contrasts a
 * typical key-based setup (described generally, never as one named library)
 * with the Palamedes workflow. Timings come from the guarded benchmark data.
 */
const palamedes = BENCH_REALISTIC.rows.find((row) => row.tool === "Palamedes");
const sameScope = BENCH_REALISTIC.rows.filter((row) => row.sameScope).map((row) => row.medianMs);
if (!palamedes || sameScope.length === 0) {
  throw new Error("Realistic benchmark is missing its rows");
}
const palamedesTime = displayBenchmarkTime(palamedes.medianMs);
const othersRange = `${displayBenchmarkTime(Math.min(...sameScope))}–${displayBenchmarkTime(Math.max(...sameScope))}`;
const reference = blacksmithBench.profiles
  .find((profile) => profile.id === "realistic")
  ?.frameworks.find((framework) => framework.id === "react")
  ?.rows.find((row) => row.tool === "Palamedes");
const referenceTimes = reference
  ? blacksmithBench.platforms.map((platform) => {
      const value = reference.values[platform.id];
      if (value.status !== "validated" || value.medianMs === undefined)
        throw new Error("Palamedes reference benchmark must have validated medians");
      return `${displayBenchmarkTime(value.medianMs)} on ${platform.label}`;
    })
  : null;

const ROWS = [
  {
    topic: "Writing UI text",
    typical: "Invent a key like checkout.cta_v2, then type the text into a JSON file.",
    palamedes: "Write the sentence in the component. That’s it.",
  },
  {
    topic: "Keeping languages in sync",
    typical: "Copy new keys into every language file by hand. Old ones linger forever.",
    palamedes: "One command adds new sentences to every catalog and flags the deleted ones.",
  },
  {
    topic: "What translators receive",
    typical: "Keys and JSON, often without a hint where the text appears.",
    palamedes: "The full sentence and the component it lives in, in a standard .po file.",
  },
  {
    topic: "What the browser downloads",
    typical: "Often every message of a language, with message syntax interpreted at runtime.",
    palamedes: "Compiled messages for the screens that are actually open. Nothing to parse.",
  },
  {
    topic: "Framework wiring",
    typical: "Your own loaders, providers, and middleware for server and client.",
    palamedes: "A first-party adapter for your framework, tested as a real app.",
  },
  {
    topic: "Tooling speed",
    typical: referenceTimes
      ? "Compare each tool’s measured median in the framework and platform table below."
      : `${othersRange} per extraction run for four popular tools in the local Mac recording.`,
    palamedes: referenceTimes
      ? `${referenceTimes.join(" and ")} for the 1,500-file React reference workload.`
      : `${palamedesTime} on the same project in the local Mac recording.`,
  },
] as const;

export function BeforeAfter() {
  return (
    <Band labelledBy="before-after-title">
      <BandHeader
        id="before-after-title"
        kicker="What changes"
        title="i18n, without the bookkeeping."
        lede="In a typical key-based setup you maintain a second codebase next to your app: a name for every text, a file per language, glue for every framework. Here is what Palamedes takes off your plate."
      />
      <div className="mt-14 border-t border-ink">
        <div
          aria-hidden
          className="hidden grid-cols-[minmax(10rem,0.7fr)_1fr_1fr] gap-8 border-b border-hair py-4 lg:grid"
        >
          <span className="micro text-[11px] tracking-label text-gray-spec">Task</span>
          <span className="micro text-[11px] tracking-label text-gray-spec">
            Typical key-based setup
          </span>
          <span className="micro text-[11px] tracking-label text-accent">With Palamedes</span>
        </div>
        <ol>
          {ROWS.map((row, index) => (
            <li key={row.topic} className="border-b border-hair">
              <div className="grid grid-cols-1 gap-x-8 gap-y-3 py-6 lg:grid-cols-[minmax(10rem,0.7fr)_1fr_1fr]">
                <h3 className="text-[17px] font-bold">{row.topic}</h3>
                <p className="text-[16px] leading-relaxed text-ink/70">
                  <span className="micro mb-1 block text-[11px] tracking-label text-gray-spec lg:sr-only">
                    Typical key-based setup:
                  </span>
                  {row.typical}
                </p>
                <p className="flex gap-3 text-[16px] leading-relaxed text-ink">
                  <span aria-hidden className="mt-2.5 size-1.5 shrink-0 rotate-45 bg-accent" />
                  <span>
                    <span className="micro mb-1 block text-[11px] tracking-label text-accent lg:sr-only">
                      With Palamedes:
                    </span>
                    {row.palamedes}
                  </span>
                </p>
              </div>
            </li>
          ))}
        </ol>
      </div>
      <Reveal>
        <p className="display-serif mt-14 text-center text-[clamp(1.6rem,1rem+2.6vw,3rem)] leading-tight">
          Clear. Complete. Fast. <span className="text-accent">Pick three.</span>
        </p>
      </Reveal>
    </Band>
  );
}
