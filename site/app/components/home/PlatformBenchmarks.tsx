import { displayBenchmarkTime } from "~/data/bench";
import { blacksmithBench, type PlatformBenchmarkData } from "~/data/blacksmith-bench";
import type { BenchmarkFramework } from "~/data/framework-bench";
import { REPO, repoHref } from "~/data/links";

export function PlatformBenchmarks({
  framework,
  data = blacksmithBench,
}: {
  framework: BenchmarkFramework;
  data?: PlatformBenchmarkData;
}) {
  const rows =
    data.profiles
      .find((profile) => profile.id === "realistic")
      ?.frameworks.find((item) => item.id === framework)?.rows ?? [];
  const label = framework === "react" ? "React" : framework[0].toUpperCase() + framework.slice(1);
  return (
    <div id="platform-benchmarks" className="mt-6 border border-hair bg-paper">
      <div className="border-b border-hair px-4 py-4 sm:px-5">
        <h3 className="text-[18px] font-semibold">One workload. Two platforms.</h3>
        <p className="mt-1 text-[14px] leading-relaxed text-ink/75">
          {label} · 1,500 files · 6,000 messages · cold CLI workflows
        </p>
      </div>
      <table className="w-full table-fixed border-collapse">
        <caption className="sr-only">
          {label} extraction workflows on Linux and macOS. Each value is the median of three VM
          medians, with seven samples per VM.
        </caption>
        <colgroup>
          <col className="w-[44%]" />
          <col className="w-[28%]" />
          <col className="w-[28%]" />
        </colgroup>
        <thead>
          <tr className="border-b border-hair">
            <th scope="col" className="px-3 py-3 text-left text-[12px] font-semibold sm:px-5">
              Tool · scope
            </th>
            {data.platforms.map((platform) => (
              <th key={platform.id} scope="col" className="px-2 py-3 text-right sm:px-5">
                <span className="block text-[14px] font-semibold">{platform.label}</span>
                <span className="block text-[11px] font-normal text-gray-spec">
                  {platform.arch}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.status === "pending" ? (
            <tr>
              <td colSpan={3} className="px-4 py-6 text-[14px] leading-relaxed sm:px-5">
                Linux and macOS measurements have not been published yet.
                <a
                  href={repoHref(".github/workflows/blacksmith-benchmarks.yml")}
                  className="mt-2 block w-fit text-accent underline"
                >
                  View the benchmark workflow →
                </a>
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={row.tool} className="border-b border-hair last:border-b-0">
                <th scope="row" className="px-3 py-4 text-left align-middle sm:px-5">
                  <span
                    className={`block text-[14px] font-semibold sm:text-[16px] ${row.tool === "Palamedes" ? "text-accent" : "text-ink"}`}
                  >
                    {row.tool}
                  </span>
                  <span className="mt-1 block text-[12px] font-normal text-gray-spec">
                    {row.scope}
                  </span>
                </th>
                {data.platforms.map((platform) => {
                  const value = row.values[platform.id];
                  return (
                    <td
                      key={platform.id}
                      data-platform={platform.id}
                      data-median-ms={value.medianMs}
                      className="mono-nums px-2 py-4 text-right align-middle text-[14px] font-semibold text-ink sm:px-5 sm:text-[17px]"
                    >
                      {value.status === "validated" && value.medianMs !== undefined ? (
                        <span className="whitespace-nowrap">
                          {displayBenchmarkTime(value.medianMs)}
                        </span>
                      ) : (
                        <span className="text-[12px] font-normal">
                          Not timed<span className="sr-only">: catalog validation failed</span>
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))
          )}
        </tbody>
      </table>
      {data.status === "measured" ? (
        <div className="border-t border-hair px-4 py-4 text-[13px] leading-relaxed text-ink/75 sm:px-5">
          <p>
            Three fresh Blacksmith VMs per platform. Three warmups and seven samples per VM. Values
            are medians of the three VM medians; platforms are reported separately.
          </p>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {data.platforms.map((platform) => (
              <p key={platform.id}>
                <strong>{platform.label}:</strong> {platform.cpu} · Node {platform.node} ·{" "}
                {platform.measured}
              </p>
            ))}
          </div>
          <p className="mt-3">
            {framework === "react"
              ? "React Intl only extracts and writes a source artifact. "
              : framework === "vue"
                ? ""
                : "Wuchale also transforms components and compiles catalogs. "}
            A failed catalog check receives no timing. Application builds and runtime rendering are
            outside this benchmark.
          </p>
          <p className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
            <a href={data.runUrl} className="text-accent underline">
              Workflow run →
            </a>
            <a href={repoHref(data.reportPath!)} className="text-accent underline">
              Raw samples and catalog checks →
            </a>
            <a href={`${REPO}/tree/${data.revision}`} className="text-accent underline">
              Measured revision {data.revision?.slice(0, 7)} →
            </a>
          </p>
        </div>
      ) : null}
    </div>
  );
}
