/*
 * Per-rival comparison content for the /compare/* landing pages.
 *
 * These pages compare open-source client and framework architecture. The
 * argument is stronger when every claim survives being looked up. Ground
 * rules, in order of importance:
 *
 * 1. Every factual claim about another project comes from the dated research
 *    notes in docs/research/competitors/frameworks/ — `researched` carries
 *    that date so the page can say when it was true.
 * 2. `respect` states what the other project is genuinely better at, and
 *    `flipside` states what that strength costs its users. Both are sourced.
 *    Naming the cost is not a cheap shot: maturity really does mean accreted
 *    API surface, and breadth really does mean thinner depth per target.
 * 3. Benchmark numbers appear only where a checked report actually measured
 *    that tool (see bench.ts / verify-site-bench-data.mjs). Where nothing was
 *    measured, the page says so instead of implying a win.
 * 4. `honest` names a real Palamedes limitation against that rival — stated
 *    as a deliberate tradeoff, because that is what it is, not as an apology.
 */

import { BENCH_REALISTIC } from "./bench"

/*
 * Keep comparison data importable by its contract test without a site
 * prebuild. The generated content statistics are for page-level proof
 * surfaces; these named, supported hosts are the durable comparison fact.
 */
const SUPPORTED_SERVER_FRAMEWORKS =
  "Next.js, TanStack Start, Solid, Waku, React Router and Remix v3"

export interface RivalFact {
  label: string
  value: string
}

export interface RivalDifference {
  title: string
  body: string
}

export interface RivalRow {
  criterion: string
  rival: string
  palamedes: string
}

export interface RivalCode {
  caption: string
  rivalLabel: string
  rivalCode: string
  palamedesLabel: string
  palamedesCode: string
  note?: string
}

export interface RivalEvaluation {
  title: string
  body: string
  label: string
  href: string
}

export interface RivalFaq {
  q: string
  a: string
}

export interface Rival {
  slug: string
  name: string
  /** Package or project the numbers refer to. */
  subject: string
  researched: string
  metaTitle: string
  metaDescription: string
  eyebrow: string
  headline: string
  lede: string
  /** One-line positioning for the /compare hub card. */
  card: string
  facts: RivalFact[]
  /** The confident statement of position, shown directly under the hero. */
  thesis: string
  /** The evaluation situation this comparison is written to help resolve. */
  audience: string
  /** One proof artifact placed beside the workflow outcomes. */
  outcomeProof: { label: string; href: string }
  respectTitle: string
  respect: string[]
  flipsideTitle: string
  /** What those strengths cost the people using them. Sourced, not snide. */
  flipside: string[]
  differences: RivalDifference[]
  rows: RivalRow[]
  code: RivalCode
  pickRival: string[]
  pickPalamedes: string[]
  honest: string
  migration?: { body: string; label: string; href: string }
  /** A bounded, reversible way to learn whether a switch is justified. */
  evaluation: RivalEvaluation
  /** Visible comparison questions; route metadata derives FAQPage schema from these. */
  faq: RivalFaq[]
}

type RivalSource = Omit<Rival, "audience" | "outcomeProof" | "evaluation" | "faq">

function speedup(tool: string): string {
  const row = BENCH_REALISTIC.rows.find((candidate) => candidate.tool === tool)
  const palamedes = BENCH_REALISTIC.rows.find((candidate) => candidate.tool === "Palamedes")
  if (!row || !palamedes) throw new Error(`rivals.ts: no realistic bench row for ${tool}`)
  return `${Math.round(row.medianMs)} ms vs ${Math.round(palamedes.medianMs)} ms`
}

/*
 * Exact ratios belong in the checked, scoped comparison rows below. Public
 * copy uses a deliberately floored factor, so a single local benchmark run is
 * never presented with false precision in a headline or decision prompt.
 */
function publicFactor(key: keyof typeof BENCH_REALISTIC.ratios): string {
  return `${Math.floor(Number.parseFloat(BENCH_REALISTIC.ratios[key]))}×`
}

const NO_BENCHMARK =
  "Not measured. The checked harness covers Lingui, React Intl, fbtee, i18next-cli, and General Translation; anything else would be a guess."

/*
 * The argument that applies to every page: extraction and catalog work is
 * compiler work, and compiler work has been moving to native code across the
 * entire JavaScript toolchain. Palamedes starts from that premise rather than
 * retrofitting it.
 */
export const NATIVE_SHIFT = {
  title: "The toolchain already moved. i18n tooling mostly hasn't.",
  body: `Bundling went native with esbuild and Rolldown. Transforms went native with SWC and OXC. Linting and formatting went native with Biome and Oxlint. Extraction, catalog merging and ICU validation are the same category of work — parse the source, understand it, write structured output — and almost all of it is still running on JavaScript plugin stacks assembled over a decade. Palamedes was built after that shift rather than before it: one Rust core (ferrocat) owns parsing, merging, auditing and compilation. In the checked benchmark it is 5× faster than the narrower extraction-only React Intl lane and 30× to 100× faster than the four catalog-update workflows.`,
}

const RIVAL_SOURCE: RivalSource[] = [
  {
    slug: "lingui",
    name: "Lingui",
    subject: "@lingui/core 6.5.0",
    researched: "July 2026",
    metaTitle: `Palamedes vs Lingui — the same authoring model, ${publicFactor("lingui")} faster`,
    metaDescription:
      "Lingui and Palamedes share the same authoring instinct: macros in your components, source strings as identity, .po catalogs. Palamedes rebuilds the machinery underneath in Rust — and runs the checked benchmark an order of magnitude faster.",
    eyebrow: "Compare · Lingui",
    headline: `The same idea, on an engine ${publicFactor("lingui")} faster.`,
    lede: "Lingui got the authoring model right, and we are not going to pretend otherwise — write the message where the UI happens, let the source string be the identity, keep catalogs translators already know. Palamedes agrees with every part of that, then replaces the machinery underneath: one Rust core instead of a JS plugin stack, one runtime access model instead of several.",
    card: `The closest relative — and the checked benchmark says ${publicFactor("lingui")} faster on the same workflow.`,
    facts: [
      { label: "Licence", value: "MIT" },
      { label: "Identity", value: "Source-derived or explicit IDs" },
      { label: "Catalogs", value: ".po, native" },
      {
        label: "Checked benchmark",
        value: `${publicFactor("lingui")} slower`,
      },
    ],
    thesis:
      "If you already believe in macro-based authoring and .po catalogs, the argument is not about the model — you and Lingui and we all agree on it. The argument is about what runs it. Lingui's extraction is a JavaScript toolchain that has been extended, worker-threaded and now experimentally re-hosted on Rolldown to chase the performance the architecture makes hard. Palamedes started on a native core and never had to chase it.",
    respectTitle: "What Lingui earned",
    respect: [
      "Macro-based authoring, source-derived identity and native PO catalogs form a coherent client-to-catalog workflow.",
      "Genuinely broad framework support: React, React Native, Vue 3, SolidJS and vanilla JS are first-party, not community ports.",
      "Native ICU MessageFormat and first-class .po catalogs, so translator tooling works without adapters.",
    ],
    flipsideTitle: "What that history costs you",
    flipside: [
      "v6 was a hard cut — ESM-only, Node ≥22.19, YAML config removed, and a changed auto-ID encoding that forces manual catalog rewrites. The former @lingui/macro entry point is no longer maintained.",
      "Breadth thins out per target: Astro has been requested since 2023 and is still not first-party, and the App Router dynamic-route extraction limitation has been open since 2025.",
      "The performance ceiling is architectural. Worker threads and an experimental Rolldown extractor are real engineering aimed at a JS-toolchain constraint that a native core does not have.",
    ],
    differences: [
      {
        title: "One runtime model, not several entry points",
        body: "Palamedes exposes exactly one way for transformed code to reach the active instance: getI18n(). No provider tree to thread, no second hook for server components, no separate path for RSC. The same call works in a Next.js server component, a Solid island, and an Express handler — which means the runtime chapter of your onboarding doc is one paragraph long.",
      },
      {
        title: "Catalog semantics in one native engine",
        body: "Parsing, updating, auditing, ICU diagnostics and artifact compilation all live in one Rust core, not spread across JS plugins. The speed is the visible consequence; the useful one is that the same catalog semantics apply no matter which adapter called them, so an audit result cannot depend on which side of the toolchain asked.",
      },
      {
        title: "One identity convention, permanently",
        body: "Lingui lets you choose between source-derived IDs and explicit custom IDs. Palamedes does not offer the second path, on purpose: identity is the source string plus optional context, full stop. That is one fewer decision at the start and one fewer schism at year three, when half the catalog has drifted into a naming convention nobody wrote down.",
      },
    ],
    rows: [
      {
        criterion: "Authoring",
        rival: "Macros, JSX-first",
        palamedes: "Macros, JSX-first — deliberately familiar",
      },
      {
        criterion: "Message identity",
        rival: "Source-derived IDs or explicit custom IDs",
        palamedes: "message + context only, no second convention",
      },
      {
        criterion: "Runtime access",
        rival: "i18n object, hooks, macros",
        palamedes: "getI18n(), one model everywhere",
      },
      {
        criterion: "Catalog engine",
        rival: "JS tooling with a plugin ecosystem",
        palamedes: "Native Rust core, semantic merge and audits",
      },
      {
        criterion: "Extract + update, realistic corpus",
        rival: speedup("Lingui"),
        palamedes: `${BENCH_REALISTIC.ratios.lingui} faster on realistic extract + catalog update¹`,
      },
      {
        criterion: "Framework coverage",
        rival: "React, React Native, Vue, Solid, vanilla",
        palamedes: `React and Solid across ${SUPPORTED_SERVER_FRAMEWORKS}; no Vue, no React Native`,
      },
      {
        criterion: "Verified host coverage",
        rival: "Broad UI-framework packages",
        palamedes: "Smoke-verified examples; browser-capable examples checked weekly",
      },
    ],
    code: {
      caption: "Authoring barely changes. That is the point.",
      rivalLabel: "Lingui",
      rivalCode: `import { t } from "@lingui/core/macro"

function checkoutLabel(seats) {
  return t\`Buy \${seats} seats\`
}`,
      palamedesLabel: "Palamedes",
      palamedesCode: `import { t } from "@palamedes/core/macro"

function checkoutLabel(seats) {
  return t\`Buy \${seats} seats\`
}`,
      note: "If your Lingui code already avoids explicit IDs, most of it reads identically after the import swap. Your components are not the migration — the catalogs and the runtime wiring are, and the playbook covers both.",
    },
    pickRival: [
      "You need Vue or React Native. Palamedes has neither and will not fake it.",
      "You depend on a Lingui plugin or TMS integration with no Palamedes equivalent yet.",
      "You want the option of explicit message IDs for part of your catalog.",
    ],
    pickPalamedes: [
      `Extraction has become a real cost in CI or your pre-commit hook — ${publicFactor("lingui")} on the checked realistic extract + catalog-update workflow is the difference between a pause and a coffee break.`,
      "You want exactly one runtime access model across server components, client islands and backend code.",
      "You want catalog semantics, audits and ICU diagnostics from one engine instead of several layers that can disagree.",
      "You are on React or Solid and expect to change meta-framework at some point.",
    ],
    honest:
      "Lingui covers Vue and React Native while Palamedes does not, and its plugin surface is broader. Palamedes instead verifies supported React and Solid hosts around one runtime model and native catalog engine. If an unsupported UI framework or Lingui-specific plugin is required, Lingui is the technical fit.",
    migration: {
      body: "Source-string-first .po catalogs usually survive a migration after one extraction pass. Explicit-ID-heavy projects need a cleanup pass first — the playbook covers both routes, including the runtime wiring and the macro scope rules that differ.",
      label: "Migration playbook",
      href: "/docs/migrate-from-lingui",
    },
  },
  {
    slug: "fbtee",
    name: "fbtee",
    subject:
      "fbtee 3.0.1 / @nkzw/fbtee-cli 3.0.1 / @nkzw/babel-preset-fbtee 3.0.1 / @nkzw/swc-plugin-fbtee 3.0.1",
    researched: "August 2026",
    metaTitle: "Palamedes vs fbtee — FBT grammar or a PO/ICU workflow?",
    metaDescription:
      "fbtee modernizes Facebook FBT with React, Expo and grammar-specific primitives. Palamedes favors standard PO/ICU catalogs and one native workflow. Compare the code, tradeoffs and checked benchmark.",
    eyebrow: "Compare · fbtee",
    headline: "Grammar in JSX, or standards through the pipeline.",
    lede: "fbtee and Palamedes start from the same useful instinct: keep the sentence beside the interface and let a compiler do the bookkeeping. They disagree about where localization grammar should live. fbtee puts a purpose-built FBT language into JSX and compiles it into hashed JSON tables. Palamedes uses ICU messages, source-readable catalogs and one native engine from extraction through compilation.",
    card: "The modern FBT continuation — explicit grammar primitives and Expo support against standard PO/ICU catalogs and one native workflow.",
    facts: [
      { label: "Licence", value: "MIT" },
      { label: "Grammar model", value: "FBT primitives and IR" },
      { label: "Catalogs", value: "Hash-keyed JSON" },
      {
        label: "Checked benchmark",
        value: `${publicFactor("fbtee")} slower`,
      },
    ],
    thesis:
      "fbtee is the strongest current argument that source-local authoring needs more grammar, not less. Its plural, pronoun, enum, list and rich-text primitives encode translation intent explicitly and inherit a model proven at Facebook scale. Palamedes makes the opposite portability bet: keep the compiler-specific surface small, keep durable catalogs legible as PO or FCL, and carry ICU semantics through one engine that also owns merges, audits, diagnostics and compilation. The right choice is which layer you want to own your localization model.",
    respectTitle: "What fbtee earned",
    respect: [
      "A grammar-first message model with dedicated plurals, gendered pronouns, enums, lists and nested React elements — not conventions layered onto a string lookup.",
      "A credible modern continuation of Facebook FBT, with React 19, TypeScript, Vite, Next.js, Babel, SWC and an explicit Expo path rather than an archival compatibility fork.",
      "A practical repository-local translation flow: missing work is added to locale JSON with a status marker that coding agents can complete and reviewers can inspect in a normal diff.",
    ],
    flipsideTitle: "What that model asks you to adopt",
    flipside: [
      "The grammar is an FBT-specific JSX and function vocabulary. It is expressive, but the authoring model and compiled IR are tied to this toolchain rather than shared with ICU implementations outside JavaScript.",
      "Editable locale files are keyed by hashes of source text and required descriptions. The source remains available in each record, but the durable catalog interface is not a source-readable gettext catalog.",
      "The local catalog path is still a JavaScript CLI pipeline: collect writes an intermediate source file, prepare-translations updates locale files, and translate compiles runtime payloads. The optional Rust/Wasm component handles source transformation, not the full catalog lifecycle.",
    ],
    differences: [
      {
        title: "Two different homes for grammar",
        body: "fbtee makes grammatical intent visible through dedicated source primitives. That is excellent when developers should model gender, pronouns and enums explicitly. Palamedes writes plural and select semantics as ICU, so the same message grammar survives in a standard catalog vocabulary translators and non-JavaScript systems already understand.",
      },
      {
        title: "Readable catalogs versus opaque identity",
        body: "fbtee derives identity from source text plus a required description, then stores the entry under a hash. Palamedes keeps the source message itself as the PO msgid, with optional context. Both avoid invented application keys; only one leaves the durable catalog readable without knowing the compiler's hash scheme.",
      },
      {
        title: "A transform is not the whole workflow",
        body: "fbtee offers both Babel and a Rust/Wasm SWC transform, which is a real integration advantage. Palamedes puts extraction, semantic catalog merging, audits, ICU diagnostics and artifact compilation in the same Rust core, then keeps framework adapters focused on request scope, routing boundaries and rendering.",
      },
    ],
    rows: [
      {
        criterion: "Source authoring",
        rival: "Inline <fbt>, fbt() and fbs() with required descriptions",
        palamedes: "Inline macros and JSX; context is optional",
      },
      {
        criterion: "Grammar model",
        rival: "FBT IR: plural, pronoun, enum, list and rich-text primitives",
        palamedes: "ICU MessageFormat plural, select and formatter semantics",
      },
      {
        criterion: "Durable catalog",
        rival: "Hash-keyed source and locale JSON",
        palamedes: "Source-readable PO or opt-in FCL",
      },
      {
        criterion: "Toolchain",
        rival: "Babel or Rust/Wasm SWC transform plus JavaScript CLI",
        palamedes: "Native extraction, catalog operations, validation and compilation",
      },
      {
        criterion: "React Native",
        rival: "Documented Expo setup and template",
        palamedes: "Not supported",
      },
      {
        criterion: "Server integration",
        rival: "React locale context plus explicit server setup",
        palamedes: "Request-local runtime across the supported server frameworks",
      },
      {
        criterion: "Agent translation",
        rival: "Status-marked JSON workflow documented for coding agents",
        palamedes: "Repository-owned catalogs with source-readable context and audits",
      },
      {
        criterion: "Collect + catalog update, realistic corpus",
        rival: speedup("fbtee"),
        palamedes: `${BENCH_REALISTIC.ratios.fbtee} faster on the checked same-inventory workflow¹`,
      },
    ],
    code: {
      caption: "Both make the plural explicit. They standardize different languages.",
      rivalLabel: "fbtee",
      rivalCode: `<fbt desc="Seat purchase button">
  Buy{' '}
  <fbt:plural
    count={seats}
    many="seats"
    name="seatCount"
    showCount="yes"
  >
    a seat
  </fbt:plural>
</fbt>`,
      palamedesLabel: "Palamedes",
      palamedesCode: `import { plural } from "@palamedes/core/macro"

plural(seats, {
  one: "Buy one seat",
  other: "Buy # seats",
})`,
      note: "fbtee's source is more prescriptive and gives translators mandatory context; that is a strength when the team wants the FBT grammar discipline. Palamedes uses an ICU plural that remains visible in a standard catalog, with context available when the source sentence alone is insufficient.",
    },
    pickRival: [
      "You ship React Native or Expo. Palamedes has no adapter there and fbtee documents the path.",
      "FBT's dedicated gender, pronoun, enum and list primitives fit how your team wants developers to express grammar.",
      "You are migrating an existing Facebook FBT codebase and want a modern continuation rather than an authoring-model change.",
      "Required descriptions at every callsite are a discipline you actively want to enforce.",
    ],
    pickPalamedes: [
      "Your durable translation interface should be source-readable PO or FCL rather than hash-keyed JSON.",
      "ICU interoperability matters across languages, tools or systems outside this JavaScript application.",
      "You want extraction, merging, audits, diagnostics and compilation to share one native catalog engine.",
      "You need one request-local runtime model across every supported server framework.",
      `The checked local collect-and-update path matters: ${publicFactor("fbtee")} on the realistic fixture separates the two workflows on the measured machine.`,
    ],
    honest:
      "fbtee supports Expo and gives developers a richer dedicated grammar vocabulary than Palamedes. If React Native or FBT's explicit pronoun and gender model is central to the product, fbtee is the better fit. Palamedes instead chooses ICU portability, source-readable catalogs and a native end-to-end catalog engine; the checked speed result applies to that local workflow only, not runtime rendering or bundle size.",
  },
  {
    slug: "i18next",
    name: "i18next",
    subject: "i18next 26.3.4 / react-i18next 17.0.8",
    researched: "July 2026",
    metaTitle: "Palamedes vs i18next — stop maintaining a naming layer",
    metaDescription: `i18next asks every developer to invent and maintain keys. Palamedes uses the sentence you already wrote — and extracts it up to ${publicFactor("i18nextCli")} faster on the checked workflow.`,
    eyebrow: "Compare · i18next",
    headline: "You already know what the string says.",
    lede: "i18next identifies messages by keys you invent, namespace, remember and keep in sync with a JSON tree. Palamedes identifies them by the source text you already typed. That single decision deletes a whole category of weekly work, changes what a missing translation looks like in production, and changes what lands in your translators' inbox.",
    card: "A key-first plugin architecture. One question splits it: do keys identify your messages, or does the text?",
    facts: [
      { label: "Licence", value: "MIT" },
      { label: "Identity", value: "Explicit keys + namespaces" },
      { label: "Catalogs", value: "JSON, key-based" },
      {
        label: "Checked benchmark",
        value: `up to ${publicFactor("i18nextCli")} slower`,
      },
    ],
    thesis:
      "The key-based model, JSON namespaces, plugin stack and opt-in ICU plugin form a flexible runtime architecture, and together they are also a layer your team maintains. Palamedes removes the naming layer instead of optimizing it: the sentence is the identity, ICU is the format rather than an opt-in, and extraction is a compile step in a Rust core.",
    respectTitle: "What i18next earned",
    respect: [
      "A modular core and plugin architecture cover a wide range of runtimes, data backends, detectors and bundlers.",
      "A modular plugin architecture covering nearly every backend, detector and bundler combination you are likely to need.",
      "Genuinely framework-agnostic: the same core runs in React, Vue, Angular, Node and Deno, with ports outside JavaScript entirely.",
    ],
    flipsideTitle: "What that inheritance costs you",
    flipside: [
      "The key-based model has a signature runtime failure: when a lookup misses, users see checkout.button.buy unless fallback behavior and source copy are configured separately.",
      "Type-checking string keys has been expensive at scale — reported tsc slowdowns and out-of-memory crashes on large namespace sets, mitigated only recently, with three overlapping typing modes spanning v25 to v27.",
      "RSC support lagged badly: next-i18next stayed Pages-Router-only for years after the App Router shipped, and the official guidance was to bypass it and wire react-i18next by hand — a gap competitors were built specifically to fill.",
    ],
    differences: [
      {
        title: "A missing translation still reads like a sentence",
        body: "When a key-based lookup misses, the UI can show the raw key to a user. Palamedes falls back to the source string, so the worst case is untranslated English rather than an identifier that looks like a crash. The fallback is the message you already wrote — there is nothing to configure and nothing to forget.",
      },
      {
        title: "No naming layer to maintain",
        body: "Key-based workflows ask every developer to invent, namespace and remember identifiers, keep them in sync with a JSON tree, and review each other's naming in pull requests. Source-string identity deletes that job. You write the sentence, extraction finds it, and context disambiguates the rare genuine collision.",
      },
      {
        title: "ICU is the format, not a plugin",
        body: "i18next ships its own interpolation syntax and treats ICU MessageFormat as an opt-in plugin that replaces it. Palamedes is ICU throughout — the same nested plural and select semantics travel from source through catalog to runtime, with a checked proof that they survive the trip rather than a claim that they should.",
      },
      {
        title: "Extraction is a compile step, not a convention",
        body: `Palamedes parses your source in a Rust core instead of scanning by convention. On the checked realistic corpus that shows up against the current i18next CLI: ${speedup("i18next-cli")} for i18next-cli on the same inventory.¹`,
      },
    ],
    rows: [
      {
        criterion: "Message identity",
        rival: "Keys you invent and maintain",
        palamedes: "The source string plus optional context",
      },
      {
        criterion: "Missing translation shows",
        rival: "The raw key, in production",
        palamedes: "The source text",
      },
      {
        criterion: "Catalog format",
        rival: "JSON namespaces",
        palamedes: ".po (gettext), FCL opt-in",
      },
      {
        criterion: "ICU MessageFormat",
        rival: "Opt-in plugin, replaces the native format",
        palamedes: "Native, end to end, with a checked proof",
      },
      {
        criterion: "Extract + update, realistic corpus",
        rival: speedup("i18next-cli"),
        palamedes: `${BENCH_REALISTIC.ratios.i18nextCli} faster on realistic extract + catalog update¹`,
      },
      {
        criterion: "Framework reach",
        rival: "React, Vue, Angular, Node, Deno, and more",
        palamedes: "React and Solid, plus request-local i18n on Node servers",
      },
      {
        criterion: "Ecosystem",
        rival: "Very large plugin and integration surface",
        palamedes: "Small and new — first-party adapters only",
      },
    ],
    code: {
      caption: "The same button, two ideas of what identifies it.",
      rivalLabel: "i18next",
      rivalCode: `// en/checkout.json
// { "button": { "buy": "Buy {{count}} seats" } }

const { t } = useTranslation("checkout")
t("button.buy", { count: seats })`,
      palamedesLabel: "Palamedes",
      palamedesCode: `import { plural } from "@palamedes/core/macro"

plural(seats, {
  one: "Buy one seat",
  other: "Buy # seats",
})`,
      note: "With i18next the JSON file is the source of truth and the component points at it — two places, kept in sync by discipline. With Palamedes the component is the source of truth and the catalog is generated from it.",
    },
    pickRival: [
      "You need i18n outside React and Solid — Angular, Vue, jQuery or plain Node.",
      "You depend on the plugin ecosystem: specific backends, detectors, or post-processors.",
      "You need an existing i18next-specific backend, detector or post-processor.",
    ],
    pickPalamedes: [
      "Key maintenance has become a chore, or raw keys have already leaked into production UI.",
      "Your translators would rather receive .po files than nested JSON — most professional tooling would.",
      "You want ICU semantics guaranteed end to end rather than swapped in via plugin.",
      `Extraction time matters in CI: ${publicFactor("i18nextCli")} on the checked realistic extract + catalog-update workflow against i18next-cli.`,
    ],
    honest:
      "i18next reaches frameworks Palamedes does not support, its plugin ecosystem has no equivalent here, and there is no migration playbook from i18next yet — moving a key-based catalog to source-string identity is technical migration work you would be doing largely by hand today.",
  },
  {
    slug: "next-intl",
    name: "next-intl",
    subject: "next-intl 4.13.1",
    researched: "July 2026",
    metaTitle: "Palamedes vs next-intl — one framework deep, or six frameworks wide",
    metaDescription:
      "next-intl is the most Next.js-idiomatic i18n library there is, routing included. Palamedes trades that depth for one runtime and message model across supported hosts — and ships source-string extraction as the stable path, not an experiment.",
    eyebrow: "Compare · next-intl",
    headline: "One framework deep, or six frameworks wide.",
    lede: "next-intl is built into Next.js as far as a library can be — localized pathnames, domain routing and RSC integration are the product, not add-ons. That depth is genuinely valuable and it is also the shape of the lock-in. Palamedes draws the boundary differently: your framework keeps routing, while Palamedes carries the same authoring, catalog, validation, and runtime model across supported hosts.",
    card: "Next-native depth including routing, against one shared model across supported hosts.",
    facts: [
      { label: "Licence", value: "MIT" },
      { label: "Scope", value: "Next.js (use-intl for plain React)" },
      { label: "Message identity", value: "Explicit keys" },
      { label: "Routing", value: "Core feature" },
    ],
    thesis:
      "Both projects made a deliberate scope decision and they went opposite ways. next-intl bet that i18n and routing belong together inside one framework, and executed that bet very well. We bet that the framework layer is the part most likely to change under you — so Palamedes owns the part that does not: authoring, identity, catalogs, runtime lookup. Notably, the piece of next-intl that most resembles our approach — compile-time source-string extraction — is still shipping behind unstable_ prefixes. For us it is the only path there is.",
    respectTitle: "What next-intl earned",
    respect: [
      "Deep App Router and RSC integration, including request configuration and server-component translation APIs.",
      "Locale routing as product: middleware, domain routing and localized pathnames work out of the box — real work you would otherwise write and maintain yourself.",
      "A strong type-safety story, with TypeScript augmentation of message keys and optionally of ICU argument shapes.",
    ],
    flipsideTitle: "What that depth costs you",
    flipside: [
      "It is one framework's library. Teams that later diversify off Next.js drop to the lower-level use-intl and rebuild the routing and RSC integration themselves — the part that supplied the framework depth.",
      "Its routing, middleware and request-configuration APIs are intentionally coupled to Next.js. Reusing the message layer elsewhere does not carry those integrations with it.",
      "The source-string extraction workflow is explicitly experimental, with reported non-deterministic PO ordering across rebuilds, no default-locale fallback for missing translations, and a generated hash in the msgid rather than the source text.",
    ],
    differences: [
      {
        title: "Routing stays with your framework",
        body: "This is a genuine tradeoff and we will not spin it as a feature gap. next-intl gives you localized routing inside the library. Palamedes gives you headless locale controls — resolution, the deliberate-choice cookie, canonical URLs — and leaves URLs to your router. You wire a little more once. You also keep the wiring, and your router stays framework-native and unwrapped.",
      },
      {
        title: "The model outlives the framework choice",
        body: `Palamedes runs the same runtime and identity model across ${SUPPORTED_SERVER_FRAMEWORKS}. Its examples are smoke-checked on relevant PRs and main pushes across four locale strategies; browser-capable examples run the Playwright contract weekly or on manual dispatch. That is not a compatibility table — it is a test suite. Changing meta-framework changes your routing layer and nothing about your messages.`,
      },
      {
        title: "Source strings as the stable path, not the experiment",
        body: "next-intl's stable path is key-based JSON. Its experimental extraction workflow does compile source strings, but writes a generated hash into the PO msgid, inverting the gettext convention translators rely on. Palamedes keeps the source string as the msgid, because a .po file a human can read without tooling is the entire reason the format won.",
      },
    ],
    rows: [
      {
        criterion: "Framework scope",
        rival: "Next.js, deeply",
        palamedes: "Next.js, TanStack Start, Solid, Waku, React Router, Remix v3",
      },
      {
        criterion: "Locale routing",
        rival: "Built in: middleware, domains, localized paths",
        palamedes: "Headless controls; your router owns URLs",
      },
      {
        criterion: "Message identity",
        rival: "Keys in JSON (stable path)",
        palamedes: "message + context",
      },
      {
        criterion: "Source-string extraction",
        rival: "Experimental, unstable_-prefixed",
        palamedes: "The only path, and the stable one",
      },
      {
        criterion: "Catalog format",
        rival: "JSON; PO only in the experimental workflow, hash msgid",
        palamedes: ".po with the source string as msgid",
      },
      {
        criterion: "Extract + update speed",
        rival: NO_BENCHMARK,
        palamedes:
          "Checked report covers Lingui, React Intl, fbtee, i18next and General Translation",
      },
      {
        criterion: "Host boundary",
        rival: "Next.js routing and request lifecycle",
        palamedes: "Shared runtime model; routing remains host-owned",
      },
    ],
    code: {
      caption: "Both are ICU underneath. The difference is what you have to name.",
      rivalLabel: "next-intl",
      rivalCode: `// messages/en.json
// { "Checkout": { "buy": "Buy {seats} seats" } }

const t = useTranslations("Checkout")
t("buy", { seats })`,
      palamedesLabel: "Palamedes",
      palamedesCode: `import { t } from "@palamedes/core/macro"

function buyLabel(seats) {
  return t\`Buy \${seats} seats\`
}`,
      note: "next-intl asks you to name a namespace and a key. Palamedes asks you to write the sentence. Both compile to ICU; only one of them adds a naming step to every string you ship.",
    },
    pickRival: [
      "You are all-in on Next.js and have no plan to change that.",
      "You want localized pathnames or domain routing without writing the routing layer yourself.",
      "You want the most Next-idiomatic API available, including its typed message keys.",
    ],
    pickPalamedes: [
      "You run more than one meta-framework, or expect to within the lifetime of this codebase.",
      "You want .po catalogs your translators can read without a converter.",
      "You want message identity that does not depend on someone naming things well.",
      "You want compile-time source-string extraction on a stable API rather than behind an unstable_ prefix.",
    ],
    honest:
      "If Next.js is your only target and you want routing to come from your i18n library, next-intl is the better fit and this page will not pretend otherwise. Palamedes leaves routing to the framework, and our own Next.js support requires Next 16, where next-intl reaches further back. That is the cost of a current, verified support matrix, and we would rather charge it than carry compatibility code for versions we cannot verify.",
  },
  {
    slug: "react-intl",
    name: "React Intl",
    subject: "react-intl 10.1.14",
    researched: "July 2026",
    metaTitle: "Palamedes vs React Intl — ICU rigor without the Context dead end",
    metaDescription:
      "React Intl is the ICU standard-bearer in JavaScript. Palamedes keeps the ICU rigor and drops the React Context runtime — which is exactly what makes server components work without a bypass.",
    eyebrow: "Compare · React Intl",
    headline: "Keep the ICU rigor. Lose the provider.",
    lede: "React Intl set the standard for ICU MessageFormat in JavaScript and we have no argument with the format — we have an argument with the plumbing. Resolving messages through React Context was the right call in 2014 and it is the reason React Server Components are a workaround here rather than a supported path.",
    card: "The ICU standard-bearer. Same rigor here, minus the Context tree that blocks server components.",
    facts: [
      { label: "Licence", value: "BSD-3-Clause" },
      { label: "Runtime", value: "React Context" },
      { label: "Server components", value: "Not supported natively" },
      {
        label: "Checked benchmark",
        value: `${publicFactor("formatjs")} slower`,
      },
    ],
    thesis:
      "This is the clearest architectural split on any of these pages. Context is a client-tree mechanism, and RSC removed the client tree from half your application. No amount of maintenance fixes that from inside — it is a design premise, and the open request to use React Intl without Context has been sitting there accordingly. Palamedes resolves through getI18n(), backed by request-local async context on the server, so there is no bypass to write because there is no boundary to cross.",
    respectTitle: "What React Intl earned",
    respect: [
      "The reference implementation for ICU MessageFormat in JavaScript — plurals, select, selectordinal, rich text and full number and date skeletons, done properly.",
      "Standards-based to the core: ICU and ECMA-402 are cross-platform, which keeps your translation vocabulary portable well beyond JavaScript.",
      "Its own Intl.* polyfill packages, which still matter for runtimes with incomplete ECMA-402 support — something Palamedes does not offer at all.",
    ],
    flipsideTitle: "What that architecture costs you",
    flipside: [
      "No React Server Components, structurally. The Context-based runtime is incompatible with RSC, so App Router and every other RSC-first framework need a manual workaround.",
      "Boilerplate is the API. A <FormattedMessage> around every string is explicit and verbose, and the default non-precompiled path carries the ICU parser at runtime unless you opt into /no-parser plus AST precompilation.",
      "Newer React meta-frameworks are on you: TanStack Start, Waku and React Router have no first-class integration, so their server and routing boundaries require application-level wiring.",
    ],
    differences: [
      {
        title: "No Context means server components just work",
        body: "React Intl resolves messages through React Context, which RSC cannot cross — App Router setups need a bypass. Palamedes resolves through getI18n(), backed by request-local async context on the server. The same component code runs in an RSC, a client island, or an Express route, and none of those cases is the special one.",
      },
      {
        title: "Editing a string does not orphan its translations",
        body: "In React Intl's generated-ID workflow, the extraction tooling derives message IDs from a content hash of the default message. Fixing a typo then changes the ID and can orphan existing translations unless your tooling diffs for it. Palamedes uses the source string plus context as identity and resolves updates through semantic catalog merging, which is built for exactly this — because typos get fixed.",
      },
      {
        title: "Macros instead of component boilerplate",
        body: "Palamedes macros compile away: you write a tagged template or a <Trans> with real JSX children, and the transform produces the runtime call. Same ICU output, none of the wrapper, and the file you actually read stays readable. The scaffolding was never the rigor.",
      },
    ],
    rows: [
      {
        criterion: "ICU MessageFormat",
        rival: "Native — the reference implementation",
        palamedes: "Native, with a checked source-to-runtime proof",
      },
      {
        criterion: "Server components",
        rival: "Not supported natively (Context-based)",
        palamedes: "First-class via request-local scope",
      },
      {
        criterion: "Message identity",
        rival: "Explicit IDs; generated hash IDs optional",
        palamedes: "message + context",
      },
      {
        criterion: "Catalog format",
        rival: "Custom JSON plus TMS formatter adapters",
        palamedes: ".po (gettext), FCL opt-in",
      },
      {
        criterion: "Authoring",
        rival: "<FormattedMessage> components and hooks",
        palamedes: "Compile-time macros, erased at build",
      },
      {
        criterion: "Extract + update, realistic corpus",
        rival: speedup("React Intl"),
        palamedes: `${BENCH_REALISTIC.ratios.formatjs} faster on realistic extraction-only¹`,
      },
      {
        criterion: "Intl polyfills",
        rival: "Shipped as separate packages",
        palamedes: "None — modern runtimes only",
      },
    ],
    code: {
      caption: "Same ICU semantics, different amount of scaffolding.",
      rivalLabel: "React Intl",
      rivalCode: `<FormattedMessage
  id="checkout.buy"
  defaultMessage="Buy {seats} seats"
  values={{ seats }}
/>`,
      palamedesLabel: "Palamedes",
      palamedesCode: `<Trans>Buy {seats} seats</Trans>`,
      note: "One benchmark caveat worth stating plainly: the React Intl extraction workflow writes a single aggregated message file, while the other tools also merge and update per-locale catalogs. It is doing less work in that row, and it is still slower.",
    },
    pickRival: [
      "You need Intl.* polyfills for runtimes without full ECMA-402 support. This one is not close.",
      "Your app is client-components-only and the Context model causes you no friction.",
      "You rely on an established React Intl integration for your TMS.",
    ],
    pickPalamedes: [
      "You are on the App Router or another RSC-first framework and want i18n without a bypass.",
      "You want .po catalogs instead of a custom JSON format.",
      "Message edits should not risk orphaning translations.",
      "You want less per-string boilerplate without giving up a single thing about ICU.",
    ],
    honest:
      "React Intl has the deeper ICU pedigree and a polyfill story we simply do not have; if your runtime targets need those polyfills, stop reading here. Palamedes also supports fewer formatter kinds at runtime than full ICU — the compiler reports the unsupported ones as errors rather than failing quietly at 3am, but it is a smaller surface and you should check it against your catalog before switching.",
  },
  {
    slug: "paraglide",
    name: "Paraglide (inlang)",
    subject: "@inlang/paraglide-js 2.23.2",
    researched: "August 2026",
    metaTitle: "Palamedes vs Paraglide — smaller bundles, bigger constraints",
    metaDescription:
      "Paraglide compiles messages into tree-shakable functions with no runtime library and wins on bundle size. Palamedes keeps a hook-free runtime lookup, .po catalogs, and source-string identity.",
    eyebrow: "Compare · Paraglide",
    headline: "Smaller bundles. Bigger constraints.",
    lede: "Paraglide compiles each message into its own tree-shakable function and ships no i18n runtime at all. The bundle-size win is real and we will not argue with it. The tradeoffs are adopting the inlang project and plugin model and a key namespace you still have to design; both libraries deliberately load a new document when the locale changes.",
    card: "Zero runtime and smaller bundles, against source-string authoring and standard .po catalogs.",
    facts: [
      { label: "Licence", value: "MIT" },
      { label: "Architecture", value: "Compile-time codegen" },
      { label: "Catalogs", value: "Inlang project + plugin-backed files" },
      { label: "Locale switch", value: "Full page reload" },
    ],
    thesis:
      "Both projects are compile-time by conviction and both treat locale as document bootstrap state. The disagreement is which build artifact and authoring model are worth paying for: Paraglide emits independently tree-shakable named functions, while Palamedes keeps source sentences at the call site and emits standard PO catalogs behind one small hook-free lookup contract.",
    respectTitle: "What Paraglide earned",
    respect: [
      "A genuinely zero-runtime architecture: messages become plain ESM functions, so unused ones are tree-shaken away entirely.",
      "A documented bundle-size advantage — their own comparison cites 47 KB against i18next's 205 KB for a five-locale example, and independent write-ups report reductions of the same order.",
      "Excellent generated TypeScript: autocomplete and compile-time errors for message keys and parameters, with no hand-written declarations.",
    ],
    flipsideTitle: "What that architecture costs you",
    flipside: [
      "Generated function names remain part of the application API, so teams still design and maintain a key namespace even though the calls are fully typed.",
      "The tree-shaking promise has documented gaps: a maintainer confirmed that re-exporting messages from a shared file — an ordinary pattern — defeats it, and per-locale build splitting is still an open feature request years in.",
      "Paraglide requires an inlang project and plugin layer even when external JSON, YAML or i18next files remain the translation source; the checked first-party plugin catalog does not list PO.",
    ],
    differences: [
      {
        title: "A document-level locale lifecycle",
        body: "Paraglide's v2 architecture and Palamedes both switch locale by loading a new document. Palamedes treats that as a stability boundary: framework state, module singletons, formatters, and application caches restart under one locale instead of attempting a partial reactive update.",
      },
      {
        title: "Standard PO catalogs as the handover",
        body: "Paraglide compiles an inlang project and connects external translation resources through plugins. Palamedes writes gettext .po directly with the source string as msgid, so CAT and TMS tooling can consume the catalog without a project-specific plugin layer.",
      },
      {
        title: "Source strings instead of keys",
        body: "Paraglide messages are key-based: you call m.checkout_buy(), which means you still design a namespace and still maintain it. Palamedes keeps the sentence in the component and derives identity from it. No namespace to design, and a missing translation degrades to readable English rather than an identifier.",
      },
    ],
    rows: [
      {
        criterion: "Client runtime",
        rival: "None — compiled message functions",
        palamedes: "Hook-free runtime lookup",
      },
      {
        criterion: "Bundle size",
        rival: "The strong suit — tree-shaken per message",
        palamedes: "Larger; not the axis Palamedes optimizes",
      },
      {
        criterion: "Locale switching",
        rival: "Full page reload by design",
        palamedes: "Full document navigation by design",
      },
      {
        criterion: "Message identity",
        rival: "Keys, compiled to functions",
        palamedes: "message + context",
      },
      {
        criterion: "Catalog format",
        rival: "Inlang project + plugin-backed resources",
        palamedes: ".po (gettext), FCL opt-in",
      },
      {
        criterion: "Framework coverage",
        rival: "Broad, via one Vite plugin",
        palamedes: `React and Solid across ${SUPPORTED_SERVER_FRAMEWORKS}`,
      },
      {
        criterion: "Extract + update speed",
        rival: NO_BENCHMARK,
        palamedes:
          "Checked report covers Lingui, React Intl, fbtee, i18next and General Translation",
      },
    ],
    code: {
      caption: "Compiled functions, or the sentence itself.",
      rivalLabel: "Paraglide",
      rivalCode: `// messages/en.json
// { "checkout_buy": "Buy {seats} seats" }

import { m } from "./paraglide/messages.js"

m.checkout_buy({ seats })`,
      palamedesLabel: "Palamedes",
      palamedesCode: `import { t } from "@palamedes/core/macro"

function buyLabel(seats) {
  return t\`Buy \${seats} seats\`
}`,
      note: "Paraglide's call site is a typed function with an autocompleted name — which you invented. Palamedes' call site is the sentence. Both are compile-time; they disagree about whether naming is work worth doing.",
    },
    pickRival: [
      "Bundle size is the number you are judged on. Paraglide wins that axis, clearly and by construction.",
      "You prefer independently generated message functions over a shared runtime lookup.",
      "You want the .inlang ecosystem: Sherlock in VS Code, Fink for translators.",
      "You need framework coverage beyond React and Solid from a single plugin.",
    ],
    pickPalamedes: [
      "Your localization workflow consumes .po and you want first-class catalogs without a custom plugin or conversion step.",
      "You want source strings as identity instead of a key namespace to design and defend.",
      "You want catalog audits and ICU diagnostics as part of the toolchain, not as a separate product.",
      "You want one hook-free runtime contract across client code, RSC, SSR, and backend handlers.",
    ],
    honest:
      "Paraglide's bundle-size story is better than ours and we are not going to claim otherwise — zero runtime beats a runtime layer on that axis by construction, and that is a fine reason to pick it. Palamedes spends those kilobytes on source-string lookup, compiled PO catalogs, rich-message adapters, and a shared server/client contract. Both libraries use document navigation for locale changes. Nothing in the checked benchmark harness measures Paraglide, so there is no speed claim on this page.",
  },
  {
    slug: "tolgee",
    name: "Tolgee JS SDK",
    subject: "@tolgee/core 7.1.3 / @tolgee/react 7.1.3",
    researched: "August 2026",
    metaTitle: "Palamedes vs the Tolgee JS SDK — source strings or explicit keys",
    metaDescription:
      "A technical comparison of the MIT-licensed Tolgee JavaScript SDK and Palamedes: runtime keys and framework bindings versus source-string extraction and compiled catalogs.",
    eyebrow: "Compare · Tolgee JS SDK",
    headline: "A runtime key, or the sentence itself.",
    lede: "The MIT-licensed Tolgee JavaScript SDK puts a framework-independent client runtime beneath idiomatic React, Vue, Angular and Svelte bindings. Palamedes starts earlier in the pipeline: it extracts the sentence from source, compiles repository-owned catalogs and keeps runtime adapters thin. This page compares only those open-source client architectures.",
    card: "An MIT client runtime with broad framework bindings. The split is explicit keys versus extracted source strings.",
    facts: [
      { label: "Compared code", value: "JavaScript client SDK only" },
      { label: "SDK licence", value: "MIT" },
      { label: "Bindings", value: "React, Vue, Angular, Svelte" },
      { label: "Message identity", value: "Explicit keys" },
    ],
    thesis:
      "Tolgee's client SDK is runtime-centered: configure the core, load static data or a backend plugin, then resolve explicit keys through a framework binding. Palamedes is compiler-centered: write the source sentence, extract it into a repository-owned catalog and compile the runtime artifact. Both provide an MIT client path and ICU messages; they disagree about whether developers should name every message and whether catalog production belongs inside the client architecture.",
    respectTitle: "What the Tolgee JS SDK earned",
    respect: [
      "A framework-independent core keeps runtime behavior aligned across first-party React, Vue, Angular and Svelte bindings.",
      "The bindings expose idiomatic providers and hooks instead of asking every framework to wrap a generic API by hand.",
      "Static translation data is a first-class client configuration and can be supplied directly to the runtime.",
    ],
    flipsideTitle: "What the runtime-first model costs you",
    flipside: [
      "Every message has an explicit string key, which introduces a namespace developers must design, remember and keep aligned with the readable source copy.",
      "The client SDK consumes translation data but does not by itself provide Palamedes' PO-first extraction, semantic catalog merging and compilation workflow.",
      "Translation loading remains runtime configuration — static data or a backend plugin — rather than a build artifact derived from the same source pass as extraction.",
    ],
    differences: [
      {
        title: "The source string is the identity",
        body: "Palamedes derives public message identity from the sentence plus optional context. There is no checkout_buy key to invent, no second label to keep aligned with the copy and no unreadable fallback when a translation is missing.",
      },
      {
        title: "Catalog production is part of the toolchain",
        body: "Extraction, PO updates, audits, semantic merging and compilation run through one native core. The runtime receives a compiled artifact instead of also owning the policy for fetching and assembling translation data.",
      },
      {
        title: "Adapters follow the host boundary",
        body: "Tolgee offers a broader set of first-party client bindings. Palamedes currently focuses on React and Solid, then verifies those adapters across supported meta-frameworks and server hosts instead of claiming equivalent breadth.",
      },
    ],
    rows: [
      {
        criterion: "Compared surface",
        rival: "MIT JavaScript client SDK",
        palamedes: "MIT local toolchain and runtime adapters",
      },
      {
        criterion: "Message identity",
        rival: "Keys you invent and maintain",
        palamedes: "The source string plus optional context",
      },
      {
        criterion: "Translation input",
        rival: "Static data or a configured backend plugin",
        palamedes: "Compiled artifacts from repository-owned PO catalogs",
      },
      {
        criterion: "ICU MessageFormat",
        rival: "Native client message syntax",
        palamedes: "Native end to end, with a checked proof",
      },
      {
        criterion: "Framework bindings",
        rival: "React, Vue, Angular and Svelte",
        palamedes: `React and Solid across ${SUPPORTED_SERVER_FRAMEWORKS}`,
      },
      {
        criterion: "Extract + update speed",
        rival:
          "Not measurable locally. `tolgee extract print` reports to the console and writes no files; catalogs arrive through `tolgee pull` from the platform.",
        palamedes:
          "Checked report covers Lingui, React Intl, fbtee, i18next and General Translation",
      },
    ],
    code: {
      caption: "A runtime key, or the sentence itself.",
      rivalLabel: "Tolgee JS SDK",
      rivalCode: `import { useTranslate } from "@tolgee/react"

const { t } = useTranslate()
t("checkout_buy", { seats })`,
      palamedesLabel: "Palamedes",
      palamedesCode: `import { t } from "@palamedes/core/macro"

function buyLabel(seats) {
  return t\`Buy \${seats} seats\`
}`,
      note: "Tolgee's call site resolves an explicit key through the configured client. Palamedes' call site is the readable sentence and extraction produces its catalog entry.",
    },
    pickRival: [
      "You prefer explicit keys and runtime-configured translation data.",
      "You need first-party Vue, Angular or Svelte bindings in addition to React.",
      "A framework-independent client plugin surface is the center of your integration.",
      "You already have static keyed translation data and do not need PO-first extraction.",
    ],
    pickPalamedes: [
      "You want source strings as identity instead of designing and maintaining a key namespace.",
      "Extraction, PO updates, audits and compilation should be one local workflow.",
      "Catalog changes should be produced and reviewed alongside source changes.",
      "You need checked React and Solid integrations across supported server and meta-framework hosts.",
    ],
    honest:
      "The Tolgee JS SDK covers more client frameworks than Palamedes today: there are first-party Vue, Angular and Svelte bindings, while Palamedes supports React and Solid. If client-framework breadth is the deciding constraint, that difference matters. Tolgee's connected platform also offers contextual AI translation, prompt and model controls, MCP, in-context collaboration, content delivery and self-hosting. Those are meaningful product advantages, but they are deliberately outside this technical comparison of the MIT client SDK.",
  },
  {
    slug: "intlayer",
    name: "Intlayer",
    subject: "intlayer 9.0.1",
    researched: "July 2026",
    metaTitle: "Palamedes vs Intlayer — declared dictionaries or extracted source strings",
    metaDescription:
      "Intlayer asks you to declare a dictionary next to every component. Palamedes reads the sentence you already wrote. Both avoid the central JSON namespace; only one of them adds work per string.",
    eyebrow: "Compare · Intlayer",
    headline: "Write the dictionary, or write the sentence.",
    lede: "Intlayer and Palamedes agree on something most of this field does not: the central JSON namespace was a mistake. Intlayer's answer is to declare a dictionary file beside each component. Ours is to read the string out of the component itself. That single difference decides how much work each new message costs you, and who has to name it.",
    card: "The other anti-namespace project. It declares dictionaries; we read the sentence you wrote.",
    facts: [
      { label: "Licence", value: "Apache-2.0" },
      { label: "Identity", value: "Explicit dictionary keys" },
      { label: "Catalog layout", value: "Co-located declarations" },
      { label: "ICU", value: "Selectable, not default" },
    ],
    thesis:
      "Intlayer removes the scanner, and that genuinely removes a class of problems — nothing can be in your code but missing from the catalog if the catalog is what you wrote. The cost is that every message is now two edits instead of one: the sentence in the component, and the entry in the declaration file, under a key you invented. Palamedes takes the opposite trade. We keep a scanner, and we make it a native compiler good enough that you stop thinking about it, so a new message stays exactly one edit: type the sentence.",
    respectTitle: "What Intlayer earned",
    respect: [
      "No extraction step at all, which means no scanner to trust and no possibility of a string existing in code but not in the catalog. That class of bug simply cannot occur.",
      "Co-location genuinely answers 'where does this string live' — the dictionary sits in the folder with the component it serves, not in a tree three directories away.",
      "The widest first-party adapter matrix in this whole comparison: React, Vue, Angular, Svelte, Solid, Preact, Lit, Astro, Next, Nuxt, React Native and four backend frameworks, all Apache-2.0.",
    ],
    flipsideTitle: "What declaring by hand costs you",
    flipside: [
      "The naming layer is still there. Every dictionary carries an explicit key, so you still invent identifiers and still keep them straight — the work moved from a central JSON tree into per-component files rather than disappearing.",
      "Declarations are locale-inline by default: t({ en, fr, es }) puts every language into a TypeScript file developers own. That reads well at three locales and becomes a merge-conflict surface at twelve, with translator content living in source files.",
      "The configuration surface spans dictionary declaration, locale layout, framework adapters and selectable message formats; migrations must account for those project-level choices.",
    ],
    differences: [
      {
        title: "A new message is one edit, not two",
        body: "With Intlayer, shipping a string means writing the sentence in the component and adding it to a declaration file under a key. With Palamedes you write the sentence and stop — extraction finds it, catalog merging places it, and the audit tells you if anything went wrong. The scanner is not a chore we failed to remove; it is the thing that keeps the work at one edit.",
      },
      {
        title: "No key, not even a local one",
        body: "Intlayer's dictionaries are keyed, so useIntlayer('multi_lang') still depends on somebody having named that dictionary well. Palamedes derives identity from the source string plus optional context. There is no name to invent, no name to misremember, and no name to argue about in review.",
      },
      {
        title: "ICU is the default, not a setting",
        body: "Intlayer can speak ICU — format: 'icu' is one of five options, alongside its own DSL, i18next, vue-i18n and PO. But the default is the house format, so portable ICU semantics depend on a project-level configuration choice. Palamedes is ICU throughout with a checked proof that nested select and plural survive the full pipeline.",
      },
      {
        title: ".po is the handover, not an export mode",
        body: "Palamedes writes gettext .po with the source string as msgid so CAT and TMS tooling can process the artifact directly. Intlayer supports PO as a format value; whether it round-trips msgctxt, plural forms and comments losslessly could not be verified, and a handover format is only worth as much as its fidelity.",
      },
    ],
    rows: [
      {
        criterion: "How messages get into catalogs",
        rival: "You declare them in a per-component file",
        palamedes: "Extracted from your source by a native compiler",
      },
      {
        criterion: "Work per new message",
        rival: "Sentence plus a keyed declaration entry",
        palamedes: "The sentence",
      },
      {
        criterion: "Message identity",
        rival: "Explicit dictionary keys",
        palamedes: "The source string plus optional context",
      },
      {
        criterion: "ICU MessageFormat",
        rival: "Selectable — default is Intlayer's own DSL",
        palamedes: "Native throughout, with a checked proof",
      },
      {
        criterion: "Locale layout",
        rival: "Locale-inline by default, all languages in one file",
        palamedes: "One .po per locale, the format translators expect",
      },
      {
        criterion: "Framework coverage",
        rival: "The widest here — ~19 first-party adapters",
        palamedes: `React and Solid across ${SUPPORTED_SERVER_FRAMEWORKS}, with examples smoke-checked in CI`,
      },
      {
        criterion: "Extract + update speed",
        rival: "Not applicable — there is nothing to extract",
        palamedes:
          "Checked report covers Lingui, React Intl, fbtee, i18next and General Translation",
      },
    ],
    code: {
      caption: "The same string, and the work each one asks for.",
      rivalLabel: "Intlayer",
      rivalCode: `// checkout.content.ts
import { t, type Dictionary } from "intlayer"

export default {
  key: "checkout",
  content: {
    buy: t({ en: "Buy seats", fr: "Acheter des places" }),
  },
} satisfies Dictionary

// Checkout.tsx
const content = useIntlayer("checkout")
content.buy`,
      palamedesLabel: "Palamedes",
      palamedesCode: `import { t } from "@palamedes/core/macro"

function buyLabel(seats) {
  return t\`Buy \${seats} seats\`
}`,
      note: "Intlayer's version is two files, one invented key and one locale map that grows sideways with every language you add. Neither project makes you maintain a central namespace — but only one of them makes you maintain anything at all.",
    },
    pickRival: [
      "You need Vue, Angular, Svelte, Lit or React Native. Their adapter matrix is genuinely wider than ours.",
      "You want no extraction step in your build under any circumstances.",
      "Co-located, hand-written dictionaries match how your team already thinks about component ownership.",
      "You need first-party bindings beyond React and Solid.",
    ],
    pickPalamedes: [
      "You would rather write a sentence than a sentence plus a dictionary entry plus a key.",
      "ICU semantics should be the default and guaranteed end to end, not a configuration value.",
      "Your translators want .po files per locale, not a TypeScript file with every language inside it.",
      "You want catalog audits, ICU diagnostics and a benchmark you can re-run yourself.",
    ],
    honest:
      "Intlayer covers far more UI frameworks than Palamedes, and removing the scanner eliminates a category of failure — nothing can drift out of a catalog you wrote by hand. The technical tradeoff is repeated keyed dictionary work for every message versus one extraction compiler in the build. Which model fits depends on the team's authoring workflow.",
  },
]

/*
 * Acquisition content lives beside the researched comparison facts rather
 * than in route components. The recommendation is intentionally subjective;
 * the tables and dated research above remain the factual boundary.
 */
const RIVAL_SUPPORT: Record<string, Omit<Rival, keyof RivalSource | "faq">> = {
  lingui: {
    audience:
      "React or Solid teams already committed to source-derived messages and PO catalogs, but now feeling the drag of their extraction and catalog workflow.",
    outcomeProof: { label: "Inspect the checked extract-and-update result", href: "/proof" },
    evaluation: {
      title: "Migrate one catalog boundary first",
      body: "Keep the first change small: select one bounded feature, run the documented catalog and runtime migration there, then review the generated PO diff before changing the rest of the application. Explicit-ID-heavy catalogs need the guide's cleanup path; do not promise a mechanical import where one is not documented.",
      label: "Read the Lingui migration playbook",
      href: "/docs/migrate-from-lingui",
    },
  },
  fbtee: {
    audience:
      "React or Solid teams deciding whether a grammar-specific FBT surface or a portable PO and ICU workflow is the better long-term boundary.",
    outcomeProof: { label: "Inspect the checked local workflow result", href: "/proof" },
    evaluation: {
      title: "Evaluate one disposable feature boundary",
      body: "Use a small, isolated feature branch to rewrite one representative message flow, then inspect the generated PO catalog and the source-to-runtime proof. This tests the authoring and catalog boundary without presenting a mixed-runtime migration as a supported path.",
      label: "Start a bounded evaluation",
      href: "/get-started",
    },
  },
  i18next: {
    audience:
      "React or Solid teams for whom key naming, JSON namespace maintenance, or raw-key fallbacks have become recurring workflow cost.",
    outcomeProof: { label: "Inspect source-to-catalog and ICU proof", href: "/proof" },
    evaluation: {
      title: "Test the source-string boundary before planning migration",
      body: "There is no documented i18next migration playbook yet because moving key-based catalogs to source-string identity requires project-specific decisions. Keep evaluation reversible: model one representative feature on a branch, inspect its PO output and runtime behavior, then decide whether a migration plan is warranted.",
      label: "Run the guided evaluation setup",
      href: "/get-started",
    },
  },
  "next-intl": {
    audience:
      "Next.js teams deciding whether tightly integrated locale routing outweighs keeping their message and catalog model portable across future hosts.",
    outcomeProof: {
      label: "Inspect the verified framework and locale matrix",
      href: "/frameworks",
    },
    evaluation: {
      title: "Separate routing from the message-model question",
      body: "Try one small, non-routing feature on a branch and keep your existing route policy intact. The evaluation can establish whether source-string catalogs and the request-local runtime fit your code without claiming that Palamedes replaces next-intl's routing product.",
      label: "Review the framework boundary",
      href: "/frameworks/nextjs",
    },
  },
  "react-intl": {
    audience:
      "React teams that need ICU rigor in server components and want to remove Context-specific i18n plumbing from their application boundary.",
    outcomeProof: { label: "Inspect the executable ICU source-to-runtime proof", href: "/proof" },
    evaluation: {
      title: "Prove catalog compatibility before changing runtime code",
      body: "Start with a representative ICU fixture and run the checked proof alongside your existing catalog. Palamedes does not provide a universal React Intl migration guide; unsupported formatter kinds are a real compatibility check, not a detail to defer until rollout.",
      label: "Inspect the ICU proof",
      href: "/proof",
    },
  },
  paraglide: {
    audience:
      "Teams for whom PO catalog ownership, catalog diagnostics, and a shared server/client contract matter more than eliminating every runtime byte.",
    outcomeProof: { label: "Inspect PO ownership and workflow evidence", href: "/proof" },
    evaluation: {
      title: "Keep the bundle-size decision explicit",
      body: "There is no documented Paraglide migration path yet. Evaluate one representative feature in a branch, inspect the PO and runtime shape, and keep Paraglide when the zero-runtime bundle budget remains the deciding constraint.",
      label: "Start a bounded evaluation",
      href: "/get-started",
    },
  },
  tolgee: {
    audience:
      "React or Solid teams choosing between an explicit-key runtime client and a repository-owned source-to-catalog workflow.",
    outcomeProof: { label: "Inspect the checked catalog and ICU proof", href: "/proof" },
    evaluation: {
      title: "Evaluate the local workflow, not the connected platform",
      body: "This page compares the MIT JavaScript SDK, not Tolgee's connected product. There is no documented migration guide; use one representative feature branch to inspect source strings, generated PO catalogs, and runtime behavior before planning a broader change.",
      label: "Review the local workflow",
      href: "/get-started",
    },
  },
  intlayer: {
    audience:
      "Teams deciding whether hand-authored, co-located dictionaries are worth the repeated key and declaration work for each new message.",
    outcomeProof: { label: "Inspect the catalog and ICU proof", href: "/proof" },
    evaluation: {
      title: "Test one-edit authoring on a representative feature",
      body: "There is no documented Intlayer migration playbook yet. Keep the decision reversible by modelling one feature on a branch, reviewing the generated PO catalog and checking the source-to-runtime proof before committing to a catalog conversion.",
      label: "Start a bounded evaluation",
      href: "/get-started",
    },
  },
}

function comparisonFaqs(rival: Omit<Rival, "faq">): RivalFaq[] {
  return [
    {
      q: `Can we evaluate Palamedes without replacing ${rival.name} everywhere?`,
      a: rival.evaluation.body,
    },
    {
      q: "Does Palamedes make sense if we use only one framework?",
      a: "Yes, if the source-string, catalog and runtime model is the fit. Framework breadth is proof that the supported adapters share one model, not a requirement that one application use several frameworks. Check the supported host and its documented boundary before adopting.",
    },
    {
      q: "Who owns the catalogs?",
      a: "Palamedes keeps source-string-first PO catalogs in the repository. Extraction, catalog updates, audits, merging and compilation are local workflow steps; it does not provide a hosted TMS or machine translation service.",
    },
    {
      q: "What runtime code reaches the application?",
      a: "Transformed code reaches the active Palamedes instance through getI18n(). The exact adapter and compiled artifact depend on the supported host; inspect the framework documentation and proof rather than treating this comparison as a bundle-size claim.",
    },
    {
      q: `What do we give up by choosing Palamedes over ${rival.name}?`,
      a: rival.honest,
    },
  ]
}

export const RIVALS: Rival[] = RIVAL_SOURCE.map((rival) => {
  const supported = { ...rival, ...RIVAL_SUPPORT[rival.slug] }
  return { ...supported, faq: comparisonFaqs(supported) }
})

export function rivalBySlug(slug: string): Rival {
  const rival = RIVALS.find((candidate) => candidate.slug === slug)
  if (!rival) throw new Error(`rivals.ts: unknown rival ${slug}`)
  return rival
}

export const BENCH_FOOTNOTE =
  "¹ Median of 7 runs on the realistic corpus (1,500 files, ~400k lines, 6,000 messages — half the files carry no i18n marker), one machine-local run, same semantic validation for every tool. The full report and the harness are in the repository, and the site build fails if these numbers drift from it."
