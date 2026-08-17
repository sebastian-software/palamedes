import { ButtonLink, EditorialRail, Page, Section } from "@palamedes/site-ui"

import { AdrChip } from "~/components/architecture/AdrChip"
import { CtaBand } from "~/components/home/CtaBand"
import { decisionHref, repoHref } from "~/data/links"
import { pageMeta } from "~/lib/meta"

export const handle = { layout: "bare" }

export function meta() {
  return pageMeta({
    title: "Palamedes architecture — one native core, thin host adapters",
    description:
      "How Palamedes keeps extraction, catalog operations, compilation, and runtime artifacts coherent across TypeScript application hosts.",
    path: "/architecture",
  })
}

const MECHANISMS = [
  {
    number: "01",
    title: "Compiled, not interpreted",
    body: "Generated catalogs compile into message functions. The production entrypoints keep the ICU parser out of that module graph while compatibility entrypoints retain deliberate support for authored string catalogs.",
    artifact: "Native catalog renderer",
    href: repoHref("crates/palamedes-node/src/catalog.rs"),
    adr: ["011", "022", "023"],
  },
  {
    number: "02",
    title: "The cache trusts the file system, conservatively",
    body: "Extraction caches source analysis behind conservative file stamps. A cache miss is normal; a result that cannot be trusted is discarded instead of being treated as an optimization win.",
    artifact: "Extraction cache",
    href: repoHref("crates/palamedes/src/extract_cache.rs"),
    adr: ["019"],
  },
  {
    number: "03",
    title: "Arenas are reused, not allocated per file",
    body: "Each extraction worker owns a thread-local Oxc arena and resets it between files. On the 1,500-file corpus, replacing per-file allocation removed the allocator pressure that had obscured useful parallel work.",
    artifact: "Thread-local extraction arena",
    href: repoHref("crates/palamedes/src/extract.rs"),
    adr: ["002", "013"],
  },
  {
    number: "04",
    title: "SIMD is used where it pays",
    body: "Ferrocat's PO scanner uses vectorized byte search—including a NEON path—then falls back to portable search. The optimization lives below the catalog contract, so host adapters do not need to know it exists.",
    artifact: "Ferrocat PO scanner",
    href: "https://github.com/sebastian-software/ferrocat/blob/main/crates/ferrocat-po/src/scan.rs",
    adr: ["006"],
  },
  {
    number: "05",
    title: "Parallelism is earned by measurement",
    body: "The 1,500-file fixture measured 119 ms serial, reached 45 ms at four workers, then regressed to 197 ms at twenty. Profiling attributed 92.8% of twenty-worker samples to mach_vm_protect, so the default is bounded rather than maximal.",
    artifact: "Worker-count evidence",
    href: decisionHref("013-bounded-parallel-extraction"),
    adr: ["013"],
  },
  {
    number: "06",
    title: "Ferrocat is one catalog engine",
    body: "Ferrocat performs catalog parsing, merging, auditing, and compilation as one semantic surface. It exists so catalog correctness does not depend on a set of loosely coordinated scripts.",
    artifact: "Catalog artifact pipeline",
    href: repoHref("crates/palamedes/src/catalog_artifact", "tree"),
    adr: ["006", "015", "022"],
  },
  {
    number: "07",
    title: "The host boundary is typed and workflow-shaped",
    body: "The Node binding passes typed values across N-API and exposes meaningful workflow operations. It avoids JSON transport and avoids pushing catalog semantics back into TypeScript orchestration.",
    artifact: "Node binding surface",
    href: repoHref("crates/palamedes-node/src/lib.rs"),
    adr: ["007", "009", "010"],
  },
  {
    number: "08",
    title: "Adapters stay thin",
    body: "Framework integrations own host concerns such as module hooks, routing conventions, and rendering. They do not become alternate implementations of extraction, catalog behavior, or runtime meaning.",
    artifact: "Adapter architecture",
    href: decisionHref("008-framework-adapter-architecture"),
    adr: ["002", "008", "014"],
  },
  {
    number: "09",
    title: "Hosts converge on one runtime contract",
    body: "Each request receives one getI18n-shaped runtime and one document locale. Server rendering, hydration, formatters, and React Router RSC stay inside that request scope instead of accumulating framework-specific semantics.",
    artifact: "Request-scope contract",
    href: decisionHref("025-react-router-rsc-entry-request-scope"),
    adr: ["005", "020", "025"],
  },
  {
    number: "10",
    title: "Machine checks guard the marketing",
    body: "The site derives benchmark display, corpus scope, matrix axes, and decision indexes from checked repository data. A changed fixture or missing decision cannot silently become a stronger public claim.",
    artifact: "Public-evidence guards",
    href: repoHref("scripts/verify-site-bench-data.mjs"),
    adr: ["019", "026"],
  },
] as const

const MACHINE_LAYERS = [
  {
    number: "01",
    title: "Application",
    body: "Routes, documents, locale policy, rendering",
  },
  {
    number: "02",
    title: "Toolchain",
    body: "Author, transform, extract, validate",
  },
  {
    number: "03",
    title: "Native core",
    body: "Catalog semantics, audit, merge, compile",
  },
  {
    number: "04",
    title: "Artifacts",
    body: "Generated modules, types, locale catalogs",
  },
  {
    number: "05",
    title: "Runtime",
    body: "Request-scoped lookup and formatting",
  },
] as const

// Exact output from `renderCatalogModule()` for a catalog containing a greeting
// and a plural message. Generated with the local native renderer on 2026-08-13;
// its source and contract tests are linked from mechanism 02 below.
const COMPILED_CATALOG_ARTIFACT =
  'import{defineCompiledCatalog as __palamedesDefineCompiledCatalog}from"@palamedes/core/compiled";const __pm0=(v,r)=>r.join("Hallo ",r.value(v,"name"));const __pb0=(v,r,p)=>r.join(r.pound(p)," Nachricht");const __pb1=(v,r,p)=>r.join(r.pound(p)," Nachrichten");const __pc0={["one"]:__pb0,["other"]:__pb1};const __pm1=(v,r)=>r.plural(v,"count",0,"plural",__pc0);export const messages=__palamedesDefineCompiledCatalog({["greeting"]:__pm0,["inbox"]:__pm1});export default { messages };'

export default function Architecture() {
  return (
    <Page>
      <section className="border-b border-hair px-8 pt-16 pb-14 max-tight:px-5">
        <p className="eyebrow">Inside Palamedes</p>
        <h1 className="display-serif mt-6 max-w-[13ch] text-[clamp(2.8rem,6.5vw,6rem)] leading-[0.94] uppercase">
          “Written in Rust” is the boring half.
        </h1>
        <p className="mt-7 max-w-[48rem] text-[17px] leading-[1.7] text-ink/85">
          The useful question is where the model lives, how it crosses the host boundary, and what
          prevents a framework integration from becoming a second i18n system. Palamedes keeps the
          answer inspectable in source and decision records.
        </p>
        <div className="mt-9 flex flex-wrap gap-3">
          <ButtonLink href="/proof">Inspect the evidence</ButtonLink>
          <ButtonLink variant="outline" href={decisionHref()}>
            Read the ADR trail
          </ButtonLink>
        </div>
      </section>

      <Section
        num="00 — The wrapper question"
        eyebrow="One model, several hosts"
        title="Adapters connect the application; they do not redefine the product."
        lede="An application owns its routing, locale policy, rendering, and hosting. Palamedes owns the work that must stay consistent when any of those choices changes: authoring, transforms, catalogs, validation, compilation, and the runtime contract."
      >
        <EditorialRail tone="emphasis" className="mb-8 bg-hover-fill py-5 pr-6">
          <p className="micro text-[10px] tracking-label text-[#79521a]">The answer</p>
          <p className="mt-2 max-w-[52rem] text-[15px] leading-relaxed">
            Palamedes is not a native wrapper around five JavaScript implementations. It is one
            model that crosses a typed host boundary, produces inspectable artifacts, and leaves
            each framework adapter responsible only for its host.
          </p>
        </EditorialRail>

        <div className="border-y border-hair">
          <ol className="grid grid-cols-5 max-grid:grid-cols-1">
            {MACHINE_LAYERS.map((layer, index) => (
              <li
                key={layer.number}
                className={`min-h-40 px-5 py-5 ${index > 0 ? "border-l border-hair max-grid:border-t max-grid:border-l-0" : ""} ${index === 2 ? "bg-track" : ""}`}
              >
                <span className="mono-nums text-[10px] text-gray-spec">{layer.number}</span>
                <h2 className="mt-7 text-[15px] font-semibold">{layer.title}</h2>
                <p className="mt-2 text-[13px] leading-relaxed text-ink/70">{layer.body}</p>
              </li>
            ))}
          </ol>
          <div className="grid grid-cols-5 border-t border-hair max-grid:grid-cols-1">
            <div className="col-start-2 col-span-2 border-x border-hair bg-ink px-5 py-3 text-paper max-grid:col-span-1 max-grid:col-start-1 max-grid:border-x-0">
              <p className="micro text-[10px] tracking-label text-paper/65">
                Typed N-API boundary · between orchestration and native semantics
              </p>
            </div>
          </div>
        </div>
      </Section>

      <Section
        num="01 — Compiled output"
        eyebrow="A real production artifact"
        title="The catalog enters the application as code, not a parser job."
        lede="The native compiler renders executable catalog modules. This is exact output from the renderer—not a hand-written approximation. Production hosts load that checked artifact through the parser-free entrypoint."
      >
        <div className="border border-hair bg-ink px-5 py-5 text-paper max-tight:px-4">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-paper/20 pb-3">
            <p className="micro text-[10px] tracking-label text-paper/65">
              Generated catalog module
            </p>
            <a
              href={repoHref("crates/palamedes-node/src/catalog.rs")}
              className="micro text-[10px] tracking-label text-paper"
            >
              Inspect native renderer →
            </a>
          </div>
          <pre
            className="overflow-x-auto text-[12px] leading-relaxed text-paper/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-paper"
            tabIndex={0}
          >
            <code>{COMPILED_CATALOG_ARTIFACT}</code>
          </pre>
        </div>
      </Section>

      <Section
        num="02 — The machine"
        eyebrow="Mechanisms, not adjectives"
        title="Ten places where the design refuses to split apart."
        lede="Every claim below points to an artifact or an accepted decision. The list is intentionally implementation-facing: it is more useful than a generic language or performance badge."
      >
        <ol className="border-y border-hair">
          {MECHANISMS.map((mechanism) => (
            <li
              key={mechanism.number}
              className="grid grid-cols-[3.5rem_minmax(0,1fr)_minmax(9rem,0.4fr)] gap-5 border-b border-hair px-5 py-6 last:border-b-0 max-grid:grid-cols-[3rem_1fr]"
            >
              <span className="mono-nums text-[11px] text-gray-spec">{mechanism.number}</span>
              <div>
                <h2 className="text-[17px] font-semibold">{mechanism.title}</h2>
                <p className="mt-2 max-w-[48rem] text-[14px] leading-relaxed text-ink/80">
                  {mechanism.body}
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {mechanism.adr.map((number) => (
                    <AdrChip key={number} number={number} />
                  ))}
                </div>
              </div>
              <a
                href={mechanism.href}
                className="micro self-start text-[10px] tracking-label text-accent max-grid:col-start-2"
              >
                {mechanism.artifact} →
              </a>
            </li>
          ))}
        </ol>
      </Section>

      <CtaBand
        headline="Inspect the evidence before you choose the foundation."
        primary={{ label: "Review benchmarks and proof", href: "/proof" }}
        secondary={{ label: "Choose your framework", href: "/frameworks" }}
      />
    </Page>
  )
}
