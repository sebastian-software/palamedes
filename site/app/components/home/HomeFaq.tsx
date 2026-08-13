export const HOME_FAQ = [
  {
    q: "Is Palamedes ready for production use?",
    a: "Palamedes publishes its source, tests, examples, benchmark fixtures, and decision records so teams can inspect the supported surface. Production suitability remains a team decision: verify the framework, locale architecture, and workflow you intend to use against the current documentation and release notes.",
  },
  {
    q: "Which frameworks does Palamedes support?",
    a: "Palamedes has first-party integrations for Next.js, TanStack Start, SolidStart, Waku, React Router, Remix v3, and Vite. The framework matrix shows the example and verification status for each supported host; Remix v3 remains explicitly qualified as preview work.",
  },
  {
    q: "Does Palamedes replace a translation management system or write translations with AI?",
    a: "No. Palamedes provides a complete local workflow for source messages and repository-owned catalogs. It does not provide a hosted TMS, machine translation, or an AI translation service.",
  },
  {
    q: "Where do translation catalogs live?",
    a: "Catalogs are repository-owned artifacts. The toolchain extracts messages, updates catalogs, audits and merges them semantically, and compiles runtime artifacts as part of the application workflow.",
  },
  {
    q: "How do translators work with Palamedes?",
    a: "Palamedes keeps source-string-first PO catalogs readable in version control. Translators can work with those catalogs directly or through the import and export path of a chosen TMS; the exact external workflow and fidelity depend on that product and its project configuration.",
  },
  {
    q: "Can a team migrate from an existing i18n library?",
    a: "Yes, but migration depends on the source model, catalog format, runtime usage, and framework host. Palamedes provides a Lingui migration guide and comparison pages for selected tools; use them to establish the exact boundary before planning a migration.",
  },
] as const

export function HomeFaq() {
  return (
    <div className="border-y border-hair">
      {HOME_FAQ.map((entry, index) => (
        <details key={entry.q} className="group border-b border-hair last:border-b-0">
          <summary className="grid cursor-pointer grid-cols-[2.75rem_1fr_auto] gap-4 px-5 py-5 text-[15px] font-semibold leading-snug marker:content-none focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent">
            <span className="mono-nums text-[11px] font-normal text-gray-spec">0{index + 1}</span>
            <span>{entry.q}</span>
            <span className="text-accent group-open:hidden" aria-hidden>
              +
            </span>
            <span className="hidden text-accent group-open:inline" aria-hidden>
              −
            </span>
          </summary>
          <p className="max-w-[52rem] px-5 pb-6 pl-[5.75rem] text-[14px] leading-relaxed text-ink/80 max-tight:pl-5">
            {entry.a}
          </p>
        </details>
      ))}
    </div>
  )
}
