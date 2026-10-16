import { Reveal } from "@palamedes/site-ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router";

import { CopyCommand } from "~/components/CopyCommand";
import {
  BENCH_META,
  BENCH_REALISTIC,
  BENCH_REALISTIC_WARM,
  displayBenchmarkTime,
} from "~/data/bench";
import { docsHref } from "~/data/links";
import { usePrefersReducedMotion } from "~/hooks/usePrefersReducedMotion";

/*
 * The checked realistic benchmark, played back at 1:1 speed: every bar takes
 * exactly its measured median to fill. The table underneath is the content;
 * the bars are decoration. Prerendered, no-JS, and reduced-motion output shows
 * the finished race. Scope stays beside every row, and the cached Palamedes
 * re-run is reported on its own because the other tools have no equivalent.
 */
const ROWS = [...BENCH_REALISTIC.rows].sort((left, right) => left.medianMs - right.medianMs);
const LONGEST = Math.max(...ROWS.map((row) => row.medianMs));

const REASONS = [
  {
    title: "The ecosystem already moved.",
    body: "Bundlers, compilers, linters, and formatters went native years ago — esbuild, SWC, Oxc, Biome, Rolldown. Extraction is the same kind of work: read source, understand it, write output. So Palamedes does it in Rust too.",
  },
  {
    title: "Fast enough to stop thinking about it.",
    body: "When extraction takes milliseconds, it can run on every save and in every CI job. Nobody skips it, so the catalogs never drift away from the code.",
  },
  {
    title: "One core behind every framework.",
    body: "The same Rust core extracts, updates, checks, and compiles for every adapter. Next.js and Solid behave the same way because they run the same code.",
  },
] as const;

type Phase = "finished" | "ready" | "running";

export function RustRace() {
  const ref = useRef<HTMLDivElement>(null);
  const reducedMotion = usePrefersReducedMotion();
  const [phase, setPhase] = useState<Phase>("finished");
  const [elapsed, setElapsed] = useState(LONGEST);
  const frame = useRef<number | null>(null);

  const run = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    setPhase("ready");
    setElapsed(0);
    /* Two frames: let the bars render empty before their transitions start. */
    frame.current = requestAnimationFrame(() => {
      frame.current = requestAnimationFrame((start) => {
        setPhase("running");
        const tick = (now: number) => {
          const value = Math.min(now - start, LONGEST);
          setElapsed(value);
          if (value < LONGEST) {
            frame.current = requestAnimationFrame(tick);
          } else {
            frame.current = null;
            setPhase("finished");
          }
        };
        frame.current = requestAnimationFrame(tick);
      });
    });
  }, []);

  /* Play once when the race scrolls into view; never off-screen or under reduced motion. */
  useEffect(() => {
    const element = ref.current;
    if (!element || reducedMotion || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer.disconnect();
          run();
        }
      },
      { rootMargin: "-25% 0px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [reducedMotion, run]);

  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    [],
  );

  return (
    <section
      id="why-rust"
      aria-labelledby="rust-title"
      className="pmds-band pmds-band--mist relative"
    >
      <div className="meander absolute inset-x-0 top-0" aria-hidden />
      <Reveal>
        <p className="pmds-kicker">Why Rust?</p>
        <h2 id="rust-title" className="pmds-title max-w-[17em]">
          Because nobody likes waiting for their tools.
        </h2>
        <p className="pmds-lede">
          Your i18n tooling runs every time you save, commit, or open a pull request. Here is the
          same job — extract every message from a 1,500-file project and update the catalogs — in
          six tools, played back in real time.
        </p>
      </Reveal>

      <div ref={ref} className="mt-12 border border-hair bg-paper">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-hair px-5 py-4">
          <p className="mono-nums text-[15px] text-ink" aria-hidden>
            {(elapsed / 1000).toFixed(2)} s
          </p>
          {reducedMotion ? null : (
            <button
              type="button"
              onClick={run}
              disabled={phase === "running"}
              className="pmds-button pmds-button--outline disabled:opacity-60"
            >
              {phase === "running" ? "Running…" : "Run it again"}
            </button>
          )}
        </div>
        <div>
          <table className="w-full border-collapse">
            <caption className="sr-only">
              Extract and catalog update on {BENCH_REALISTIC.corpus}, median of {BENCH_META.runs}{" "}
              runs. Times are rounded.
            </caption>
            <thead>
              <tr className="border-b border-hair text-left">
                <th
                  scope="col"
                  className="micro px-5 py-3 text-[11px] tracking-label whitespace-nowrap text-slate"
                >
                  Tool · what it does
                </th>
                <th
                  scope="col"
                  className="micro w-full px-5 py-3 text-[11px] tracking-label text-slate max-sm:hidden"
                >
                  <span className="sr-only">Progress</span>
                </th>
                <th
                  scope="col"
                  className="micro px-5 py-3 text-right text-[11px] tracking-label text-slate"
                >
                  Time
                </th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map((row) => {
                const percent = (row.medianMs / LONGEST) * 100;
                const done = phase === "finished" || elapsed >= row.medianMs;
                const width = phase === "ready" ? 0 : percent;
                return (
                  <tr key={row.tool} className="border-b border-hair last:border-b-0">
                    <th
                      scope="row"
                      className="px-5 py-4 text-left align-middle sm:whitespace-nowrap"
                    >
                      <span
                        className={`block text-[16px] font-semibold ${row.accent ? "text-accent" : "text-ink"}`}
                      >
                        {row.displayName}
                      </span>
                      <span className="block text-[12.5px] font-normal whitespace-normal text-gray-spec">
                        {row.scope}
                      </span>
                      <span aria-hidden className="mt-2 block h-2 w-full bg-mist sm:hidden">
                        <span
                          className={`block h-full ${row.accent ? "bg-accent" : "bg-slate/70"}`}
                          style={{
                            width: `max(${width}%, ${width > 0 ? "3px" : "0px"})`,
                            transition:
                              phase === "running" ? `width ${row.medianMs}ms linear` : "none",
                          }}
                        />
                      </span>
                    </th>
                    <td className="px-5 py-4 align-middle max-sm:hidden" aria-hidden>
                      <span className="block h-3 w-full bg-mist">
                        <span
                          className={`block h-full ${row.accent ? "bg-accent" : "bg-slate/70"}`}
                          style={{
                            width: `max(${width}%, ${width > 0 ? "3px" : "0px"})`,
                            transition:
                              phase === "running" ? `width ${row.medianMs}ms linear` : "none",
                          }}
                        />
                      </span>
                    </td>
                    <td
                      className={`mono-nums px-5 py-4 text-right align-middle text-[17px] whitespace-nowrap transition-opacity ${done ? "opacity-100" : "opacity-30"} ${row.accent ? "text-accent" : "text-ink"}`}
                    >
                      {displayBenchmarkTime(row.medianMs)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="border-t border-hair px-5 py-4 text-[13.5px] leading-relaxed text-ink/75">
          {displayBenchmarkTime(BENCH_REALISTIC_WARM.warmMs)} on a cached re-run after{" "}
          {BENCH_REALISTIC_WARM.touchedFiles} changed source files — Palamedes keeps an extraction
          cache, the other tools re-read everything, so no speedup is claimed for it. Median of{" "}
          {BENCH_META.runs} runs on {BENCH_META.platform}, {BENCH_META.generated}. Your hardware
          will differ; the ratios are the signal.
        </p>
      </div>

      <ul className="mt-14 grid grid-cols-1 gap-x-10 gap-y-10 md:grid-cols-3">
        {REASONS.map((reason) => (
          <li key={reason.title} className="border-t border-accent/50 pt-5">
            <h3 className="text-[19px] leading-snug font-bold">{reason.title}</h3>
            <p className="mt-3 text-[16px] leading-relaxed text-ink/80">{reason.body}</p>
          </li>
        ))}
      </ul>

      <div className="mt-12 flex flex-wrap items-end gap-x-10 gap-y-4">
        <CopyCommand
          command="pnpm benchmark:e2e-workflow"
          label="Re-run it yourself"
          className="w-full max-w-[26rem]"
        />
        <Link to="/proof" viewTransition className="pmds-arrow-link">
          Every benchmark, and how it is checked →
        </Link>
        <a href={docsHref("benchmark-e2e-workflow")} className="pmds-arrow-link">
          Methodology →
        </a>
      </div>
    </section>
  );
}
