import { Band, BandHeader } from "~/components/marketing/Band";
import { browserRuntime, formatRuntimeKB } from "~/data/browser-runtime";
import { repoHref } from "~/data/links";

export function BrowserRuntime() {
  return (
    <Band id="browser-runtime" tone="parchment" labelledBy="browser-runtime-title">
      <BandHeader
        id="browser-runtime-title"
        kicker="Browser footprint"
        title="Know what reaches the browser."
        lede="Extraction, macros, and native compilers stay in your build. The browser gets compiled messages and a JavaScript runtime that uses built-in Intl. Here is that runtime, measured separately from your framework and translations."
      />
      <div
        className="mt-10 overflow-x-auto"
        role="region"
        aria-label="Browser runtime sizes"
        tabIndex={0}
      >
        <table className="w-full border-collapse text-left text-[15px]">
          <caption className="pb-4 text-left text-[13px] leading-relaxed text-gray-spec">
            Complete compiled entry points · production minification · {browserRuntime.measuredAt}
            <span className="mt-1 block">
              Excludes framework peers, host bootstrap and recovery code, catalogs, and Intl
              polyfills.
            </span>
          </caption>
          <thead className="mono-nums border-y border-hair text-[12px]">
            <tr>
              <th scope="col" className="py-3 pr-5 font-medium">
                Runtime profile
              </th>
              <th scope="col" className="px-3 py-3 text-right font-medium">
                Gzip
              </th>
              <th scope="col" className="py-3 pl-3 text-right font-medium">
                Brotli
              </th>
            </tr>
          </thead>
          <tbody>
            {browserRuntime.profiles.map((profile) => (
              <tr key={profile.id} className="border-b border-hair">
                <th scope="row" className="py-4 pr-5 font-normal">
                  <span className="font-semibold">{profile.name}</span>
                  <span className="mt-1 block max-w-[38em] text-[13px] leading-relaxed text-gray-spec">
                    {profile.hosts}
                  </span>
                </th>
                <td className="mono-nums px-3 py-4 text-right whitespace-nowrap">
                  {formatRuntimeKB(profile.bytes.gzip)}
                </td>
                <td className="mono-nums py-4 pl-3 text-right whitespace-nowrap">
                  {formatRuntimeKB(profile.bytes.brotli)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-6 grid gap-6 text-[15px] leading-relaxed text-ink/80 lg:grid-cols-2">
        <p>
          <strong className="font-semibold text-ink">Translations add content.</strong> The booking
          demo&apos;s complete English catalog has {browserRuntime.catalog.messages} messages:{" "}
          {formatRuntimeKB(browserRuntime.catalog.bytes.gzip)} gzip,{" "}
          {formatRuntimeKB(browserRuntime.catalog.bytes.brotli)} Brotli. That is a separate example
          cost. Your text and loading strategy determine what a route fetches.
        </p>
        <p>
          <strong className="font-semibold text-ink">For a Next.js app, read the React row.</strong>{" "}
          It includes Palamedes&apos; runtime and rich-text renderer. React, Next.js, generated
          client bootstrap, and catalogs are excluded. These reference bundles retain every
          entry-point export; tree-shaking and your build determine the actual application increase.
        </p>
      </div>
      <a
        className="pmds-arrow-link mt-6 inline-block text-[15px]"
        href={repoHref("benchmarks/browser-runtime", "tree")}
      >
        Inspect the measurements and reproduce them
      </a>
    </Band>
  );
}
