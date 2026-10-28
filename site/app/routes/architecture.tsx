import { ButtonLink, EditorialRail, Page, Section } from "@palamedes/site-ui";
import { PageHero } from "~/components/marketing/PageHero";
import { PlainWords } from "~/components/marketing/PlainWords";

import { AdrChip } from "~/components/architecture/AdrChip";
import { CtaBand } from "~/components/home/CtaBand";
import { StreamlineIcon } from "~/components/icons/StreamlineIcon";
import { decisionHref, repoHref } from "~/data/links";
import { pageMeta } from "~/lib/meta";

export const handle = { layout: "bare" };

export function meta() {
  return pageMeta({
    title: "Palamedes architecture — one native core, thin host adapters",
    description:
      "How Palamedes keeps extraction, catalog operations, compilation, and runtime artifacts coherent across TypeScript application hosts.",
    path: "/architecture",
  });
}

const MECHANISMS = [
  {
    number: "01",
    title: "Compiled, not interpreted",
    body: "In v2, generated catalogs compile into message functions in development and production. Package roots and compiled subpaths use the same parser-free runtime. Invalid ICU fails compilation; missing compiled entries reach host error handling.",
    artifact: "Native catalog renderer",
    href: repoHref("crates/palamedes-node/src/catalog.rs"),
    adr: ["019", "004", "005"],
  },
  {
    number: "02",
    title: "The cache trusts the file system, conservatively",
    body: "Extraction caches source analysis behind conservative file stamps. A cache miss is normal; a result that cannot be trusted is discarded instead of being treated as an optimization win.",
    artifact: "Extraction cache",
    href: repoHref("crates/palamedes/src/extract_cache.rs"),
    adr: ["022"],
  },
  {
    number: "03",
    title: "Arenas are reused, not allocated per file",
    body: "Each extraction worker owns a thread-local Oxc arena and resets it between files. On the 1,500-file corpus, replacing per-file allocation removed the allocator pressure that had obscured useful parallel work.",
    artifact: "Thread-local extraction arena",
    href: repoHref("crates/palamedes/src/extract.rs"),
    adr: ["002", "023"],
  },
  {
    number: "04",
    title: "SIMD is used where it pays",
    body: "Ferrocat's PO scanner uses vectorized byte search—including a NEON path—then falls back to portable search. The optimization lives below the catalog contract, so host adapters do not need to know it exists.",
    artifact: "Ferrocat PO scanner",
    href: "https://github.com/sebastian-software/ferrocat/blob/main/crates/ferrocat-po/src/scan.rs",
    adr: ["009"],
  },
  {
    number: "05",
    title: "Parallelism is earned by measurement",
    body: "The 1,500-file fixture measured 119 ms serial, reached 45 ms at four workers, then regressed to 197 ms at twenty. Profiling attributed 92.8% of twenty-worker samples to mach_vm_protect, so the default is bounded rather than maximal.",
    artifact: "Worker-count evidence",
    href: decisionHref("023-bounded-parallel-extraction"),
    adr: ["023"],
  },
  {
    number: "06",
    title: "Ferrocat is one catalog engine",
    body: "Ferrocat performs catalog parsing, merging, auditing, and compilation as one semantic surface. It exists so catalog correctness does not depend on a set of loosely coordinated scripts.",
    artifact: "Catalog artifact pipeline",
    href: repoHref("crates/palamedes/src/catalog_artifact", "tree"),
    adr: ["009", "021", "004"],
  },
  {
    number: "07",
    title: "The host boundary is typed and workflow-shaped",
    body: "The Node binding passes typed values across N-API and exposes meaningful workflow operations. It avoids JSON transport and avoids pushing catalog semantics back into TypeScript orchestration.",
    artifact: "Node binding surface",
    href: repoHref("crates/palamedes-node/src/lib.rs"),
    adr: ["013", "017", "018"],
  },
  {
    number: "08",
    title: "Adapters stay thin",
    body: "Framework integrations own host concerns such as module hooks, routing conventions, and rendering. They do not become alternate implementations of extraction, catalog behavior, or runtime meaning.",
    artifact: "Adapter architecture",
    href: decisionHref("008-framework-adapter-architecture"),
    adr: ["002", "008", "024"],
  },
  {
    number: "09",
    title: "Hosts converge on one runtime contract",
    body: "Servers load the active locale's complete compiled catalog lazily and share immutable messages across requests. Request-local locale and formatter state stays isolated. Browser adapters deliver the document locale's fragments along the module graph.",
    artifact: "Request-scope contract",
    href: decisionHref("006-universal-geti18n-runtime-model"),
    adr: ["006", "007"],
  },
  {
    number: "10",
    title: "Machine checks guard the marketing",
    body: "The site derives benchmark display, corpus scope, matrix axes, and decision indexes from checked repository data. A changed fixture or missing decision cannot silently become a stronger public claim.",
    artifact: "Public-evidence guards",
    href: repoHref("scripts/verify-site-bench-data.mjs"),
    adr: ["022", "011"],
  },
] as const;

/*
 * The native core is not one monolith: three first-party crates own the parts
 * that are not Palamedes-specific. Naming them here keeps the "so it is glue
 * around oxc and ferrocat?" question answerable with links instead of prose.
 */
const FOUNDATION_CRATES = [
  {
    name: "ferrocat",
    role: "Catalog and ICU semantics: PO and FCL parsing, merging, auditing, and compilation.",
    href: "https://github.com/sebastian-software/ferrocat",
  },
  {
    name: "ferromark",
    role: "CommonMark and MDX parsing behind the MDX extraction path.",
    href: "https://github.com/sebastian-software/ferromark",
  },
  {
    name: "ferralk",
    role: "Parallel source discovery during extraction.",
    href: "https://github.com/sebastian-software/ferralk",
  },
] as const;

const MACHINE_LAYERS = [
  {
    number: "01",
    icon: "app-widgets-plugin-extension",
    title: "Application",
    body: "Routes, documents, locale policy, rendering",
  },
  {
    number: "02",
    icon: "deployment-workflow-collaboration",
    title: "Toolchain",
    body: "Author, transform, extract, validate",
  },
  {
    number: "03",
    icon: "code-analysis",
    title: "Native core",
    body: "Catalog semantics, audit, merge, compile",
  },
  {
    number: "04",
    icon: "programming-book",
    title: "Artifacts",
    body: "Generated modules, types, locale catalogs",
  },
  {
    number: "05",
    icon: "browser-check",
    title: "Runtime",
    body: "Request-scoped lookup and formatting",
  },
] as const;

// Exact output from `renderCatalogModule()` for a catalog containing a greeting
// and a plural message. Generated with the local native renderer on 2026-08-13;
// its source and contract tests are linked from mechanism 02 below.
const COMPILED_CATALOG_ARTIFACT =
  'import{defineCompiledCatalog as __palamedesDefineCompiledCatalog}from"@palamedes/core/compiled";const __pm0=(v,r)=>r.join("Hallo ",r.value(v,"name"));const __pb0=(v,r,p)=>r.join(r.pound(p)," Nachricht");const __pb1=(v,r,p)=>r.join(r.pound(p)," Nachrichten");const __pc0={["one"]:__pb0,["other"]:__pb1};const __pm1=(v,r)=>r.plural(v,"count",0,"plural",__pc0);export const messages=__palamedesDefineCompiledCatalog({["greeting"]:__pm0,["inbox"]:__pm1});export default { messages };';

export default function Architecture() {
  return (
    <Page>
      <PageHero
        kicker="Architecture"
        title="One model, from your code to every runtime."
        lede="Palamedes has two halves. A native core does the heavy, shared work — extraction, catalogs, checks, compilation. Thin adapters connect it to each framework. That split is why changing or adding a framework doesn’t change your messages or your catalogs."
        aside={
          <div className="space-y-4">
            <PlainWords
              question="Why is the core written in Rust?"
              answer="Extraction and catalog work run on every save and in every CI job. Native code does that work in milliseconds instead of seconds — the same reason bundlers and compilers such as esbuild, SWC, and Oxc went native. And because every adapter calls the same core, every framework gets the same behavior."
            />
            <PlainWords
              question="What is an adapter?"
              answer="The small framework-specific piece that plugs Palamedes into Next.js, Solid, or another host: it hooks into the build, loads the right catalog on the server, and hands messages to the browser. It never re-implements the translation logic."
            />
          </div>
        }
        actions={
          <>
            <ButtonLink href="/proof">Inspect the evidence</ButtonLink>
            <ButtonLink variant="outline" href={decisionHref()}>
              Read the decision trail
            </ButtonLink>
          </>
        }
      />

      <Section
        num="00 — The wrapper question"
        eyebrow="One model, several hosts"
        title="Your app keeps its decisions. Palamedes keeps the model consistent."
        lede="An application owns its routing, locale policy, rendering, and hosting. Palamedes owns the work that must stay consistent when any of those choices changes: authoring, transforms, catalogs, validation, compilation, and the runtime contract."
      >
        <EditorialRail tone="emphasis" className="mb-8 bg-hover-fill py-5 pr-6">
          <p className="micro text-[10px] tracking-label text-[#79521a]">The answer</p>
          <p className="mt-2 max-w-[48rem] text-[17px] leading-relaxed">
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
                <div className="flex items-start justify-between gap-4">
                  <span className="mono-nums text-[10px] text-gray-spec">{layer.number}</span>
                  <StreamlineIcon name={layer.icon} />
                </div>
                <h2 className="mt-7 text-[17px] font-bold">{layer.title}</h2>
                <p className="mt-2 text-[15px] leading-relaxed text-ink/75">{layer.body}</p>
              </li>
            ))}
          </ol>
          <div className="grid grid-cols-5 border-t border-hair max-grid:grid-cols-1">
            <div className="col-start-2 col-span-2 border-x border-hair bg-mist px-5 py-3 text-ink max-grid:col-span-1 max-grid:col-start-1 max-grid:border-x-0">
              <p className="micro text-[11px] tracking-label text-slate">
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
        <div className="pmds-code px-5 py-5 max-tight:px-4">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-hair pb-3">
            <p className="micro text-[11px] tracking-label text-slate">Generated catalog module</p>
            <a
              href={repoHref("crates/palamedes-node/src/catalog.rs")}
              className="micro text-[11px] tracking-label text-accent"
            >
              Inspect native renderer →
            </a>
          </div>
          <pre
            className="overflow-x-auto text-[12.5px] leading-relaxed text-ink/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
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
        lede="Rust explains the speed. The rest of the story is where each decision lives and what keeps it from drifting. Every item below points to the code or the accepted decision behind it."
      >
        <ol className="border-y border-hair">
          {MECHANISMS.map((mechanism) => (
            <li
              key={mechanism.number}
              className="grid grid-cols-[3.5rem_minmax(0,1fr)_minmax(9rem,0.4fr)] gap-5 border-b border-hair px-5 py-6 last:border-b-0 max-grid:grid-cols-[3rem_1fr]"
            >
              <span className="mono-nums text-[11px] text-gray-spec">{mechanism.number}</span>
              <div>
                <h2 className="text-[19px] leading-snug font-bold">{mechanism.title}</h2>
                <p className="mt-2 max-w-[46rem] text-[16px] leading-relaxed text-ink/80">
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

        <div className="mt-10 border-t border-hair pt-7">
          <p className="micro text-[10px] tracking-label text-gray-spec">
            First-party Rust foundations
          </p>
          <p className="mt-3 max-w-[46rem] text-[16px] leading-relaxed text-ink/80">
            Three crates from the same open-source family carry the work that is not specific to
            Palamedes. Each is released separately, so the parsing and traversal layers can be read
            and reported against on their own.
          </p>
          <ul className="mt-6 border-y border-hair">
            {FOUNDATION_CRATES.map((crate) => (
              <li
                key={crate.name}
                className="grid grid-cols-[10rem_minmax(0,1fr)] gap-5 border-b border-hair px-5 py-4 last:border-b-0 max-grid:grid-cols-1 max-grid:gap-2"
              >
                <a href={crate.href} className="text-[15px] font-semibold text-accent">
                  {crate.name} →
                </a>
                <p className="text-[16px] leading-relaxed text-ink/80">{crate.role}</p>
              </li>
            ))}
          </ul>
        </div>
      </Section>

      <CtaBand
        headline="Inspect the evidence before you choose the foundation."
        primary={{ label: "Review benchmarks and proof", href: "/proof" }}
        secondary={{ label: "Choose your framework", href: "/frameworks" }}
      />
    </Page>
  );
}
