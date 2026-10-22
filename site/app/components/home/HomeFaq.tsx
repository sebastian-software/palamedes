export const HOME_FAQ = [
  {
    q: "Is Palamedes ready for production use?",
    a: "The repository contains the current implementation and runnable examples. npm currently ships 1.x while 2.0 publication is on hold. Start with your framework guide and its checked example; the release notes explain the package versions, and the stability guide documents the API contracts.",
  },
  {
    q: "Which frameworks does Palamedes support?",
    a: "Palamedes integrates with React, Solid, Remix, Vue, and Svelte. App integrations cover Next.js, Nuxt, SvelteKit, TanStack Start, Solid Start Mode, Waku, and React Router; Vite connects the browser builds. Hono and Express use the shared backend runtime, and Cargo connects Rust applications. Each framework guide links to its working example and describes the integration scope.",
  },
  {
    q: "Can I translate a Rust CLI with Palamedes?",
    a: "Yes. The Cargo integration prepares external language catalogs for Rust CLIs and services, including English. Cargo exports a message contract; pmds catalog compile checks compatible PO updates against it without rebuilding your app. Text, display arguments, string selects, and cardinal and ordinal plurals work today. The Rust applications guide covers the Cargo dependency and a complete example.",
  },
  {
    q: "Does Palamedes replace a translation management system or write translations with AI?",
    a: "No. Palamedes covers the complete local workflow for your source messages and the catalogs in your repository. It is not a hosted translation management system, and it does not machine-translate or AI-translate your text.",
  },
  {
    q: "Where do translation catalogs live?",
    a: "In your repository, as plain files you review like code. The toolchain extracts messages, updates the catalogs, audits and merges them by meaning, and compiles them for your build.",
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
    <div className="max-w-[56rem] border-t border-hair" data-faq-list>
      {HOME_FAQ.map((entry) => (
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
