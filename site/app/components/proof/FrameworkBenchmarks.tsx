import { CopyCommand } from "~/components/CopyCommand";
import { displayBenchmarkTime } from "~/data/bench";
import { frameworkBench } from "~/data/framework-bench";
import { repoHref } from "~/data/links";
import { BenchmarkVersion } from "./BenchmarkVersion";

type Profile = (typeof frameworkBench.profiles)[number];
type Framework = Profile["frameworks"][number];

function FrameworkTable({ profile, framework }: { profile: Profile; framework: Framework }) {
  const files = framework.rows.find((row) => row.files !== undefined)!.files!;
  return (
    <div>
      <div
        role="region"
        aria-label={`${framework.label} ${profile.id} benchmark results`}
        tabIndex={0}
        className="overflow-x-auto focus-visible:outline-2 focus-visible:outline-accent"
      >
        <table className="w-full table-fixed border-collapse text-left">
          <caption className="px-4 py-4 text-left text-[13px] leading-relaxed text-gray-spec">
            {framework.label} · {profile.id} · {files.toLocaleString("en-US")} files ·{" "}
            {profile.messages.toLocaleString("en-US")} messages
          </caption>
          <thead>
            <tr className="border-y border-hair">
              <th
                scope="col"
                className="micro w-[65%] px-4 py-3 text-[10px] tracking-th text-gray-spec"
              >
                Workflow
              </th>
              <th
                scope="col"
                className="micro px-4 py-3 text-right text-[10px] tracking-th text-gray-spec"
              >
                Median
              </th>
            </tr>
          </thead>
          <tbody>
            {framework.rows.map((row) => (
              <tr
                key={row.tool}
                className={`border-b border-hair last:border-b-0 ${row.tool === "Palamedes" ? "bg-hover-fill" : ""}`}
              >
                <th scope="row" className="px-4 py-4 text-[14px] font-semibold">
                  <span>{row.tool}</span> <BenchmarkVersion version={row.version} />
                  <span className="mt-1 block text-[11px] font-normal text-gray-spec">
                    {row.scope}
                  </span>
                </th>
                {row.medianMs === undefined ? (
                  <td className="px-4 py-4 text-right text-[12px] leading-relaxed text-gray-spec">
                    Not timed
                    <br />
                    Catalog checks failed
                  </td>
                ) : (
                  <td
                    data-median-ms={row.medianMs}
                    className={`mono-nums px-4 py-4 text-right text-[16px] whitespace-nowrap sm:text-[18px] ${row.tool === "Palamedes" ? "font-semibold text-ink" : ""}`}
                  >
                    {displayBenchmarkTime(row.medianMs)}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {framework.rows
        .filter((row) => row.status === "not-equivalent")
        .map((row) => (
          <p
            key={row.tool}
            className="border-t border-hair px-4 py-4 text-[12px] leading-relaxed text-gray-spec"
          >
            {row.tool} JSON receipt: {row.written.toLocaleString("en-US")} written entries for{" "}
            {row.expected.toLocaleString("en-US")} current messages;{" "}
            {row.preserved.toLocaleString("en-US")}/{row.expectedPreserved.toLocaleString("en-US")}{" "}
            unchanged German translations retained.
          </p>
        ))}
    </div>
  );
}

export function FrameworkBenchmarks() {
  const realistic = frameworkBench.profiles.find((profile) => profile.id === "realistic")!;
  const meta = frameworkBench.meta;
  return (
    <div id="framework-benchmarks" className="scroll-mt-24 border-t border-hair pt-10">
      <p className="micro text-[11px] tracking-label text-accent">Framework workflows</p>
      <h3 className="display-serif mt-3 text-[clamp(1.7rem,4vw,2.5rem)]">
        Vue, Svelte, and Solid.
      </h3>
      <p className="mt-4 max-w-[65ch] text-[15.5px] leading-relaxed text-ink/80">
        Real .vue, .svelte, and .tsx components, with the same logical messages and existing
        English/German catalogs. Each timed sample checks the active message set, unchanged
        translations, and source immutability. This is a separate run from the React report above.
      </p>
      <p className="mt-4 max-w-[65ch] text-[14px] leading-relaxed text-gray-spec">
        Wuchale also transforms components and compiles catalogs, so its command covers more work.
        Times include CLI startup, discovery, parsing, catalog merging, and writes. Local tool state
        is reset for each run; the OS page cache is not flushed. Plain strings and interpolation
        only; no plurals, rich text, runtime rendering, or watch-mode measurements. Solid uses the
        1.9 adapters supported by these tools.
      </p>
      <p className="mono-nums mt-4 text-[12px] leading-relaxed text-gray-spec">
        {meta.cpu} · {meta.platform} · Node {meta.node} · {meta.generated}
        <br />
        {meta.warmup} warmups · median of {meta.runs} runs · rounded display values
      </p>

      <div className="mt-8 space-y-8">
        {realistic.frameworks.map((framework) => (
          <section
            key={framework.id}
            aria-labelledby={`benchmark-${framework.id}`}
            className="border border-hair"
          >
            <h4
              id={`benchmark-${framework.id}`}
              className="border-b border-hair px-4 py-5 text-[20px] font-semibold"
            >
              {framework.label}
            </h4>
            <FrameworkTable profile={realistic} framework={framework} />
            {frameworkBench.profiles
              .filter((profile) => profile.id !== "realistic")
              .map((profile) => (
                <details key={profile.id} className="border-t border-hair">
                  <summary className="cursor-pointer px-4 py-4 text-[14px] font-semibold focus-visible:outline-2 focus-visible:outline-accent">
                    {profile.id === "small" ? "Small" : "Medium"} corpus ·{" "}
                    {profile.messages.toLocaleString("en-US")} messages
                  </summary>
                  <FrameworkTable
                    profile={profile}
                    framework={profile.frameworks.find((item) => item.id === framework.id)!}
                  />
                </details>
              ))}
          </section>
        ))}
      </div>

      <details className="mt-8 border border-hair">
        <summary className="cursor-pointer px-4 py-5 text-[15px] font-semibold focus-visible:outline-2 focus-visible:outline-accent">
          Why Intlayer has a receipt instead of a timing
        </summary>
        <p className="px-4 pb-4 text-[14px] leading-relaxed text-ink/80">
          The timed lane uses Intlayer {meta.intlayerVersion} with .content.json dictionaries. It
          retains removed entries and loses unchanged interpolated translations in this fixture. A
          separate untimed smoke check also covers .content.ts: TypeScript preserves those
          translations, while both formats retain removed entries. These findings cover the pinned
          version and configurations.
        </p>
        <div
          role="region"
          aria-label="Intlayer dictionary format conformance"
          tabIndex={0}
          className="overflow-x-auto focus-visible:outline-2 focus-visible:outline-accent"
        >
          <table className="w-full border-collapse text-left text-[13px]">
            <caption className="sr-only">
              Untimed smoke check: unchanged German translations retained and removed entries still
              present
            </caption>
            <thead>
              <tr className="border-y border-hair">
                <th scope="col" className="px-4 py-3">
                  Framework / format
                </th>
                <th scope="col" className="px-2 py-3 text-right">
                  Retained
                </th>
                <th scope="col" className="px-4 py-3 text-right">
                  Stale entries
                </th>
              </tr>
            </thead>
            <tbody>
              {frameworkBench.diagnostics.map((row) => (
                <tr key={`${row.framework}-${row.format}`} className="border-b border-hair">
                  <th scope="row" className="px-4 py-3 font-normal">
                    {row.framework}
                    <span className="mono-nums block text-[11px] text-gray-spec">{row.format}</span>
                  </th>
                  <td className="mono-nums px-2 py-3 text-right">
                    {row.preserved}/{row.expectedPreserved}
                  </td>
                  <td className="mono-nums px-4 py-3 text-right">{row.extra}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <a
          className="m-4 inline-block text-[13px] text-accent underline"
          href={repoHref(meta.diagnosticPath)}
        >
          Read the format countercheck →
        </a>
      </details>
      <div className="mt-8 flex flex-wrap items-end gap-6">
        <CopyCommand
          command="pnpm benchmark:framework-workflow"
          label="Re-run all three frameworks"
          className="w-full max-w-[30rem]"
        />
        <a className="pmds-arrow-link" href={repoHref(meta.reportPath)}>
          Full report, versions, and raw samples →
        </a>
      </div>
    </div>
  );
}
