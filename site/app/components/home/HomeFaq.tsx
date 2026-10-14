export const HOME_FAQ = [
  {
    q: "Is Palamedes ready for production use?",
    a: "Check the package version and host you intend to adopt. The 2.0 implementation is available in the repository and publication remains held. Stable APIs follow SemVer; Waku, Remix v3, and React Router RSC retain Preview contracts. The stability guide, checked examples, and release notes describe the supported paths.",
  },
  {
    q: "Which frameworks does Palamedes support?",
    a: "Palamedes has first-party integrations for Next.js, TanStack Start, Solid, Waku, React Router, Remix v3, and Vite. Waku, Remix v3, and the separate React Router RSC adapter are Preview surfaces. The framework matrix shows application verification; the stability guide describes API guarantees.",
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
    a: "The repository includes a Lingui migration guide and an agent skill for Next.js and Vite/React. Migration depends on the source model and IDs; the skill inventories them and preserves existing PO translations before changing catalogs. Other stacks require their own migration assessment.",
  },
] as const;

export function HomeFaq() {
  return (
    /* data-faq-list scopes the site guard's FAQ count to the questions
     * themselves, so an unrelated disclosure elsewhere on the page — the family
     * tool switcher in the header, for one — cannot be mistaken for an answer. */
    <div className="border-y border-hair" data-faq-list>
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
  );
}
