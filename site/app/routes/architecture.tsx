import { ButtonLink, Page, Section } from "@palamedes/site-ui"

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
    title: "One source-to-runtime model",
    body: "Messages begin beside UI source, preserve their authoring meaning through extraction and catalogs, and arrive at one runtime contract. A framework never gets a separate message identity system.",
    artifact: "Source message model",
    href: repoHref("crates/palamedes/src/source_message.rs"),
    adr: ["003", "022"],
  },
  {
    number: "02",
    title: "A parser-free production path",
    body: "Generated catalogs compile into message functions. The production entrypoints keep the ICU parser out of that module graph while compatibility entrypoints retain deliberate support for authored string catalogs.",
    artifact: "Compiled runtime entrypoints",
    href: repoHref("adr/023-generated-production-runtime-is-parser-free.md"),
    adr: ["023"],
  },
  {
    number: "03",
    title: "Changed files, not repeated work",
    body: "Extraction caches source analysis behind conservative file stamps. A cache miss is normal; a result that cannot be trusted is discarded instead of being treated as an optimization win.",
    artifact: "Extraction cache",
    href: repoHref("crates/palamedes/src/extract_cache.rs"),
    adr: ["019"],
  },
  {
    number: "04",
    title: "Native data structures where the work is native",
    body: "The Rust core owns the high-volume parsing, catalog, validation, merge, and compilation work. That keeps semantic operations together instead of distributing them across JavaScript plugin layers.",
    artifact: "Rust core",
    href: repoHref("crates/palamedes/src/lib.rs"),
    adr: ["002"],
  },
  {
    number: "05",
    title: "Measured parallelism",
    body: "Source extraction uses bounded parallel work rather than unbounded concurrency. The limit is part of the contract: it keeps a large repository responsive without turning a build into a resource contest.",
    artifact: "Bounded extraction",
    href: repoHref("crates/palamedes/src/extract.rs"),
    adr: ["013"],
  },
  {
    number: "06",
    title: "Catalog semantics in one engine",
    body: "Ferrocat performs catalog parsing, merging, auditing, and compilation as one semantic surface. It exists so catalog correctness does not depend on a set of loosely coordinated scripts.",
    artifact: "Catalog artifact pipeline",
    href: repoHref("crates/palamedes/src/catalog_artifact", "tree"),
    adr: ["022"],
  },
  {
    number: "07",
    title: "A typed, workflow-shaped boundary",
    body: "The Node binding passes typed values across N-API and exposes meaningful workflow operations. It avoids JSON transport and avoids pushing catalog semantics back into TypeScript orchestration.",
    artifact: "Node binding surface",
    href: repoHref("crates/palamedes-node/src/lib.rs"),
    adr: ["009"],
  },
  {
    number: "08",
    title: "Thin adapters, host-specific only where needed",
    body: "Framework integrations own host concerns such as module hooks, routing conventions, and rendering. They do not become alternate implementations of extraction, catalog behavior, or runtime meaning.",
    artifact: "Adapter architecture",
    href: decisionHref("008-framework-adapter-architecture"),
    adr: ["008"],
  },
  {
    number: "09",
    title: "Locale is a document boundary",
    body: "Locale selection is resolved for a browser document rather than patched into a partially live application. This keeps server output, hydration, caches, and formatters inside one coherent request scope.",
    artifact: "Locale boundary decision",
    href: decisionHref("020-locale-is-fixed-for-a-browser-document"),
    adr: ["020"],
  },
  {
    number: "10",
    title: "Public numbers are derived evidence",
    body: "The site derives its rounded benchmark display from checked exact reports. Its public claims keep scope alongside the factor, so a changed fixture cannot silently become a stronger marketing statement.",
    artifact: "Benchmark drift guard",
    href: repoHref("scripts/verify-site-bench-data.mjs"),
    adr: ["019"],
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
        <div className="grid grid-cols-[1fr_auto_1fr] items-stretch border-y border-hair max-grid:grid-cols-1">
          <div className="px-6 py-6">
            <p className="micro text-[10px] tracking-label text-gray-spec">Application host</p>
            <p className="mt-3 text-[15px] leading-relaxed">
              Routing · URLs · locale detection · rendering · hosting
            </p>
          </div>
          <div aria-hidden className="w-px bg-hair max-grid:h-px max-grid:w-full" />
          <div className="bg-track px-6 py-6">
            <p className="micro text-[10px] tracking-label text-accent">Palamedes core</p>
            <p className="mt-3 text-[15px] leading-relaxed">
              Authoring · transform · extract · catalogs · audit · merge · compile · runtime
            </p>
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
          <pre className="overflow-x-auto text-[12px] leading-relaxed text-paper/90">
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
