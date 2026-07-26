/*
 * Per-rival comparison content for the /compare/* landing pages.
 *
 * These pages are marketing. They are also checkable, and those two things are
 * not in tension — the argument is stronger when every claim survives being
 * looked up. Ground rules, in order of importance:
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
import contentStats from "./generated/content-stats.json"

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
}

function speedup(tool: string): string {
  const row = BENCH_REALISTIC.rows.find((candidate) => candidate.tool === tool)
  const palamedes = BENCH_REALISTIC.rows.find((candidate) => candidate.tool === "Palamedes")
  if (!row || !palamedes) throw new Error(`rivals.ts: no realistic bench row for ${tool}`)
  return `${Math.round(row.medianMs)} ms vs ${Math.round(palamedes.medianMs)} ms`
}

const NO_BENCHMARK =
  "Not measured. The checked harness covers Lingui, FormatJS, and the two i18next extractors; anything else would be a guess."

/*
 * The argument that applies to every page: extraction and catalog work is
 * compiler work, and compiler work has been moving to native code across the
 * entire JavaScript toolchain. Palamedes starts from that premise rather than
 * retrofitting it.
 */
export const NATIVE_SHIFT = {
  title: "The toolchain already moved. i18n tooling mostly hasn't.",
  body: "Bundling went native with esbuild and Rolldown. Transforms went native with SWC and OXC. Linting and formatting went native with Biome and Oxlint. Extraction, catalog merging and ICU validation are the same category of work — parse the source, understand it, write structured output — and almost all of it is still running on JavaScript plugin stacks assembled over a decade. Palamedes was built after that shift rather than before it: one Rust core (ferrocat) owns parsing, merging, auditing and compilation, which is why the checked benchmark comes back between 2.64× and 36.76× faster depending on which tool you put next to it.",
}

export const RIVALS: Rival[] = [
  {
    slug: "lingui",
    name: "Lingui",
    subject: "@lingui/core 6.5.0",
    researched: "July 2026",
    metaTitle: `Palamedes vs Lingui — the same authoring model, ${BENCH_REALISTIC.ratios.lingui} faster`,
    metaDescription:
      "Lingui and Palamedes share the same authoring instinct: macros in your components, source strings as identity, .po catalogs. Palamedes rebuilds the machinery underneath in Rust — and runs the checked benchmark an order of magnitude faster.",
    eyebrow: "Compare · Lingui",
    headline: `The same idea, on an engine ${BENCH_REALISTIC.ratios.lingui} faster.`,
    lede: "Lingui got the authoring model right, and we are not going to pretend otherwise — write the message where the UI happens, let the source string be the identity, keep catalogs translators already know. Palamedes agrees with every part of that, then replaces the machinery underneath: one Rust core instead of a JS plugin stack, one runtime access model instead of several.",
    card: `The closest relative — and the checked benchmark says ${BENCH_REALISTIC.ratios.lingui} faster on the same corpus.`,
    facts: [
      { label: "Adoption", value: "~1.29M downloads/week" },
      { label: "Track record", value: "Since 2017" },
      { label: "Catalogs", value: ".po, native" },
      { label: "Checked benchmark", value: `${BENCH_REALISTIC.ratios.lingui} slower` },
    ],
    thesis:
      "If you already believe in macro-based authoring and .po catalogs, the argument is not about the model — you and Lingui and we all agree on it. The argument is about what runs it. Lingui's extraction is a JavaScript toolchain that has been extended, worker-threaded and now experimentally re-hosted on Rolldown to chase the performance the architecture makes hard. Palamedes started on a native core and never had to chase it.",
    respectTitle: "What Lingui earned",
    respect: [
      "Nine years of production track record. Lingui shipped this authoring model before most of today's React i18n tooling existed, and it was right.",
      "Genuinely broad framework support: React, React Native, Vue 3, SolidJS and vanilla JS are first-party, not community ports.",
      "Native ICU MessageFormat and first-class .po catalogs, so translator tooling works without adapters.",
    ],
    flipsideTitle: "What that history costs you",
    flipside: [
      "v6 was a hard cut — ESM-only, Node ≥22.19, YAML config removed, and a changed auto-ID encoding that forces manual catalog rewrites. Months on, roughly 312k weekly downloads still land on @lingui/macro, which v6 marks as no longer maintained.",
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
        palamedes: `${BENCH_REALISTIC.ratios.lingui} faster on the checked run¹`,
      },
      {
        criterion: "Framework coverage",
        rival: "React, React Native, Vue, Solid, vanilla",
        palamedes: `React and Solid across ${contentStats.frameworkCount} meta-frameworks; no Vue, no React Native`,
      },
      {
        criterion: "Maturity",
        rival: "Mature, large community, years in production",
        palamedes: `New — but ${contentStats.adrCount} ADRs and ${contentStats.exampleCount} browser-verified apps are on the table before you commit`,
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
      `Extraction has become a real cost in CI or your pre-commit hook — ${BENCH_REALISTIC.ratios.lingui} on the checked corpus is the difference between a pause and a coffee break.`,
      "You want exactly one runtime access model across server components, client islands and backend code.",
      "You want catalog semantics, audits and ICU diagnostics from one engine instead of several layers that can disagree.",
      "You are on React or Solid and expect to change meta-framework at some point.",
    ],
    honest:
      "Lingui got here first and has the production mileage to show for it. Ours is the newer project, with a smaller ecosystem and fewer UI frameworks — and that is the deliberate shape of it, not a gap we are hurrying to close. What we put on the table instead is a narrower model, a native engine, and every tradeoff written down in the ADRs before you depend on any of it.",
    migration: {
      body: "Source-string-first .po catalogs usually survive a migration after one extraction pass. Explicit-ID-heavy projects need a cleanup pass first — the playbook covers both routes, including the runtime wiring and the macro scope rules that differ.",
      label: "Migration playbook",
      href: "/docs/migrate-from-lingui",
    },
  },
  {
    slug: "i18next",
    name: "i18next",
    subject: "i18next 26.3.4 / react-i18next 17.0.8",
    researched: "July 2026",
    metaTitle: "Palamedes vs i18next — stop maintaining a naming layer",
    metaDescription:
      "i18next is the most widely deployed i18n stack in JavaScript, and it asks every developer to invent and maintain keys. Palamedes uses the sentence you already wrote — and extracts it up to 36.76× faster on the checked benchmark.",
    eyebrow: "Compare · i18next",
    headline: "You already know what the string says.",
    lede: "i18next identifies messages by keys you invent, namespace, remember and keep in sync with a JSON tree. Palamedes identifies them by the source text you already typed. That single decision deletes a whole category of weekly work, changes what a missing translation looks like in production, and changes what lands in your translators' inbox.",
    card: "The ecosystem giant. One question splits it: do keys identify your messages, or does the text?",
    facts: [
      { label: "Adoption", value: "~18.2M downloads/week" },
      { label: "Track record", value: "Since 2011" },
      { label: "Catalogs", value: "JSON, key-based" },
      { label: "Checked benchmark", value: `up to ${BENCH_REALISTIC.ratios.i18nextCli} slower` },
    ],
    thesis:
      "Fourteen years of reach is a real asset and a real inheritance. The key-based model, the JSON namespaces, the plugin stack and the bolt-on ICU plugin all made sense when they were added, and together they are now a layer your team maintains forever. Palamedes removes the layer instead of optimizing it: the sentence is the identity, ICU is the format rather than an opt-in, and extraction is a compile step in a Rust core.",
    respectTitle: "What i18next earned",
    respect: [
      "The broadest reach in the ecosystem by a wide margin — fourteen years of production use and an install base no alternative comes close to.",
      "A modular plugin architecture covering nearly every backend, detector and bundler combination you are likely to need.",
      "Genuinely framework-agnostic: the same core runs in React, Vue, Angular, Node and Deno, with ports outside JavaScript entirely.",
    ],
    flipsideTitle: "What that inheritance costs you",
    flipside: [
      "The key-based model has a signature production failure: when a lookup misses, users see checkout.button.buy. It is common enough that i18next's own commercial companion maintains a blog category about missing translations.",
      "Type-checking string keys has been expensive at scale — reported tsc slowdowns and out-of-memory crashes on large namespace sets, mitigated only recently, with three overlapping typing modes spanning v25 to v27.",
      "RSC support lagged badly: next-i18next stayed Pages-Router-only for years after the App Router shipped, and the official guidance was to bypass it and wire react-i18next by hand — a gap competitors were built specifically to fill.",
    ],
    differences: [
      {
        title: "A missing translation still reads like a sentence",
        body: "When a key-based lookup misses, the UI shows the raw key in front of a paying customer. Palamedes falls back to the source string, so your worst case is untranslated English rather than an identifier that looks like a crash. The fallback is the message you already wrote — there is nothing to configure and nothing to forget.",
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
        body: `Palamedes parses your source in a Rust core instead of scanning by convention. On the checked realistic corpus that shows up against both i18next extractors: ${speedup("i18next-parser")} for i18next-parser, and ${speedup("i18next-cli")} for i18next-cli — ${BENCH_REALISTIC.ratios.i18nextCli} on the same inventory.¹`,
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
        rival: `${speedup("i18next-parser")} (parser) · ${speedup("i18next-cli")} (cli)`,
        palamedes: `${BENCH_REALISTIC.ratios.i18nextParser} / ${BENCH_REALISTIC.ratios.i18nextCli} faster on the checked run¹`,
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
      "You want the largest possible pool of tutorials, answers and hire-able experience.",
    ],
    pickPalamedes: [
      "Key maintenance has become a chore, or raw keys have already leaked into production UI.",
      "Your translators would rather receive .po files than nested JSON — most professional tooling would.",
      "You want ICU semantics guaranteed end to end rather than swapped in via plugin.",
      `Extraction time matters in CI: ${BENCH_REALISTIC.ratios.i18nextCli} against i18next-cli on the checked corpus.`,
    ],
    honest:
      "i18next is the default for good reasons, and no benchmark changes that. It reaches frameworks we do not support, its plugin ecosystem has no equivalent here, and there is no migration playbook from i18next yet — moving a key-based catalog to source-string identity is real work you would be doing largely by hand today. If you want that path paved before you walk it, wait for us. If key maintenance is already costing you more than the migration would, do not.",
  },
  {
    slug: "next-intl",
    name: "next-intl",
    subject: "next-intl 4.13.1",
    researched: "July 2026",
    metaTitle: "Palamedes vs next-intl — one framework deep, or six frameworks wide",
    metaDescription:
      "next-intl is the most Next.js-idiomatic i18n library there is, routing included. Palamedes trades that depth for a translation model that survives a framework change — and ships source-string extraction as the stable path, not an experiment.",
    eyebrow: "Compare · next-intl",
    headline: `One framework deep, or ${contentStats.frameworkCount} frameworks wide.`,
    lede: "next-intl is built into Next.js as far as a library can be — localized pathnames, domain routing and RSC integration are the product, not add-ons. That depth is genuinely valuable and it is also the shape of the lock-in. Palamedes owns less on purpose: your framework keeps routing, and the translation model stays identical when the framework underneath it changes.",
    card: "Next-native depth including routing, against a model that survives a framework change.",
    facts: [
      { label: "Adoption", value: "~4.0M downloads/week" },
      { label: "Scope", value: "Next.js (use-intl for plain React)" },
      { label: "Maintainers", value: "One" },
      { label: "Routing", value: "Core feature" },
    ],
    thesis:
      "Both projects made a deliberate scope decision and they went opposite ways. next-intl bet that i18n and routing belong together inside one framework, and executed that bet very well. We bet that the framework layer is the part most likely to change under you — so Palamedes owns the part that does not: authoring, identity, catalogs, runtime lookup. Notably, the piece of next-intl that most resembles our approach — compile-time source-string extraction — is still shipping behind unstable_ prefixes. For us it is the only path there is.",
    respectTitle: "What next-intl earned",
    respect: [
      "The deepest App Router and RSC integration in the field, widely treated as the de facto standard for Next.js i18n.",
      "Locale routing as product: middleware, domain routing and localized pathnames work out of the box — real work you would otherwise write and maintain yourself.",
      "A strong type-safety story, with TypeScript augmentation of message keys and optionally of ICU argument shapes.",
    ],
    flipsideTitle: "What that depth costs you",
    flipside: [
      "It is one framework's library. Teams that later diversify off Next.js drop to the lower-level use-intl and rebuild the routing and RSC integration themselves — the part they were paying for.",
      "Four million weekly downloads rest on a single maintainer, with sponsorship small relative to that adoption. That is not a criticism of the person; it is a number worth putting in the risk column.",
      "The source-string extraction workflow is explicitly experimental, with reported non-deterministic PO ordering across rebuilds, no default-locale fallback for missing translations, and a generated hash in the msgid rather than the source text.",
    ],
    differences: [
      {
        title: "Routing stays with your framework",
        body: "This is a genuine tradeoff and we will not spin it as a feature gap. next-intl gives you localized routing inside the library. Palamedes gives you headless locale controls — resolution, the deliberate-choice cookie, canonical URLs — and leaves URLs to your router. You wire a little more once. You also keep the wiring, and your router stays framework-native and unwrapped.",
      },
      {
        title: "The model outlives the framework choice",
        body: `Palamedes runs the same runtime and identity model across Next.js, TanStack Start, SolidStart, Waku, React Router and Remix v3, with ${contentStats.exampleCount} browser-verified example apps in CI covering ${contentStats.strategyCount} locale strategies each. That is not a compatibility table — it is a test suite. Changing meta-framework changes your routing layer and nothing about your messages.`,
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
        palamedes: "Next.js, TanStack Start, SolidStart, Waku, React Router, Remix v3",
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
        palamedes: "Checked report covers Lingui, FormatJS and i18next only",
      },
      {
        criterion: "Maintenance",
        rival: "Single maintainer, very large adoption",
        palamedes: "Company-maintained, small and new",
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
      "If Next.js is your only target and you want routing to come from your i18n library, next-intl is the better fit and this page will not pretend otherwise. We cover less of that surface deliberately — and our own Next.js support requires Next 16, where next-intl reaches further back. That is the cost of a small, current support matrix, and we would rather charge it than carry compatibility code for versions we cannot verify.",
  },
  {
    slug: "react-intl",
    name: "FormatJS / react-intl",
    subject: "react-intl 10.1.14",
    researched: "July 2026",
    metaTitle: "Palamedes vs react-intl — ICU rigor without the Context dead end",
    metaDescription:
      "react-intl is the ICU standard-bearer in JavaScript. Palamedes keeps the ICU rigor and drops the React Context runtime — which is exactly what makes server components work without a bypass.",
    eyebrow: "Compare · FormatJS",
    headline: "Keep the ICU rigor. Lose the provider.",
    lede: "react-intl set the standard for ICU MessageFormat in JavaScript and we have no argument with the format — we have an argument with the plumbing. Resolving messages through React Context was the right call in 2014 and it is the reason React Server Components are a workaround here rather than a supported path.",
    card: "The ICU standard-bearer. Same rigor here, minus the Context tree that blocks server components.",
    facts: [
      { label: "Adoption", value: "~3.1M downloads/week" },
      { label: "Track record", value: "~12 years" },
      { label: "Server components", value: "Not supported natively" },
      { label: "Checked benchmark", value: `${BENCH_REALISTIC.ratios.formatjs} slower` },
    ],
    thesis:
      "This is the clearest architectural split on any of these pages. Context is a client-tree mechanism, and RSC removed the client tree from half your application. No amount of maintenance fixes that from inside — it is a design premise, and the open request to use react-intl without Context has been sitting there accordingly. Palamedes resolves through getI18n(), backed by request-local async context on the server, so there is no bypass to write because there is no boundary to cross.",
    respectTitle: "What react-intl earned",
    respect: [
      "The reference implementation for ICU MessageFormat in JavaScript — plurals, select, selectordinal, rich text and full number and date skeletons, done properly.",
      "Standards-based to the core: ICU and ECMA-402 are cross-platform, which keeps your translation vocabulary portable well beyond JavaScript.",
      "Its own Intl.* polyfill packages, which still matter for runtimes with incomplete ECMA-402 support — something Palamedes does not offer at all.",
    ],
    flipsideTitle: "What that architecture costs you",
    flipside: [
      "No React Server Components, structurally. The Context-based runtime is incompatible with RSC, so App Router and every other RSC-first framework need a manual workaround.",
      "Boilerplate is the API. A <FormattedMessage> around every string is explicit and verbose, and the default non-precompiled path carries the ICU parser at runtime unless you opt into /no-parser plus AST precompilation.",
      "Newer React meta-frameworks are on you: TanStack Start, SolidStart, Waku and React Router have no first-class integration, and maintainer bandwidth on non-core-React work looks thin.",
    ],
    differences: [
      {
        title: "No Context means server components just work",
        body: "react-intl resolves messages through React Context, which RSC cannot cross — App Router setups need a bypass. Palamedes resolves through getI18n(), backed by request-local async context on the server. The same component code runs in an RSC, a client island, or an Express route, and none of those cases is the special one.",
      },
      {
        title: "Editing a string does not orphan its translations",
        body: "FormatJS derives message IDs from a content hash of the default message, so fixing a typo changes the ID and can orphan existing translations unless your tooling diffs for it. Palamedes uses the source string plus context as identity and resolves updates through semantic catalog merging, which is built for exactly this — because typos get fixed.",
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
        rival: "Content hash of the default message",
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
        rival: speedup("FormatJS"),
        palamedes: `${BENCH_REALISTIC.ratios.formatjs} faster on the checked run¹`,
      },
      {
        criterion: "Intl polyfills",
        rival: "Shipped as separate packages",
        palamedes: "None — modern runtimes only",
      },
    ],
    code: {
      caption: "Same ICU semantics, different amount of scaffolding.",
      rivalLabel: "react-intl",
      rivalCode: `<FormattedMessage
  id="checkout.buy"
  defaultMessage="Buy {seats} seats"
  values={{ seats }}
/>`,
      palamedesLabel: "Palamedes",
      palamedesCode: `<Trans>Buy {seats} seats</Trans>`,
      note: "One benchmark caveat worth stating plainly: FormatJS extracts and writes a single aggregated message file, while the other tools also merge and update per-locale catalogs. It is doing less work in that row, and it is still slower.",
    },
    pickRival: [
      "You need Intl.* polyfills for runtimes without full ECMA-402 support. This one is not close.",
      "Your app is client-components-only and the Context model causes you no friction.",
      "You rely on an established FormatJS formatter adapter for your TMS.",
    ],
    pickPalamedes: [
      "You are on the App Router or another RSC-first framework and want i18n without a bypass.",
      "You want .po catalogs instead of a custom JSON format.",
      "Message edits should not risk orphaning translations.",
      "You want less per-string boilerplate without giving up a single thing about ICU.",
    ],
    honest:
      "react-intl has the deeper ICU pedigree and a polyfill story we simply do not have; if your runtime targets need those polyfills, stop reading here. Palamedes also supports fewer formatter kinds at runtime than full ICU — the compiler reports the unsupported ones as errors rather than failing quietly at 3am, but it is a smaller surface and you should check it against your catalog before switching.",
  },
  {
    slug: "paraglide",
    name: "Paraglide (inlang)",
    subject: "@inlang/paraglide-js 2.20.2",
    researched: "July 2026",
    metaTitle: "Palamedes vs Paraglide — smaller bundles, bigger constraints",
    metaDescription:
      "Paraglide compiles messages into tree-shakable functions with no runtime library, and wins on bundle size. Palamedes keeps a small runtime and gets in-place locale switching, .po catalogs and source-string identity for it.",
    eyebrow: "Compare · Paraglide",
    headline: "Smaller bundles. Bigger constraints.",
    lede: "Paraglide compiles each message into its own tree-shakable function and ships no i18n runtime at all. The bundle-size win is real and we will not argue with it. What we will argue with is the price: a full page reload every time a user changes language, a catalog format only its own ecosystem speaks, and a key namespace you still have to design.",
    card: "Zero runtime and smaller bundles, against in-place locale switching and .po catalogs.",
    facts: [
      { label: "Adoption", value: "~358k downloads/week" },
      { label: "Architecture", value: "Compile-time codegen" },
      { label: "Catalogs", value: ".inlang project format" },
      { label: "Locale switch", value: "Full page reload" },
    ],
    thesis:
      "Both projects are compile-time by conviction, so this is not the usual runtime-versus-compiler argument — it is a disagreement about which cost is worth paying. Paraglide spends the user's locale switch to save kilobytes. Palamedes spends kilobytes to keep the switch instant and the catalogs in a format the localization industry already speaks. Which side is right depends entirely on whether your users change language, and how often your translators touch the files.",
    respectTitle: "What Paraglide earned",
    respect: [
      "A genuinely zero-runtime architecture: messages become plain ESM functions, so unused ones are tree-shaken away entirely.",
      "A documented bundle-size advantage — their own comparison cites 47 KB against i18next's 205 KB for a five-locale example, and independent write-ups report reductions of the same order.",
      "Excellent generated TypeScript: autocomplete and compile-time errors for message keys and parameters, with no hand-written declarations.",
    ],
    flipsideTitle: "What that architecture costs you",
    flipside: [
      "Locale switching is a full page reload by design. If your product switches language in-session, every user pays for the bundle saving in latency and lost scroll position.",
      "The tree-shaking promise has documented gaps: a maintainer confirmed that re-exporting messages from a shared file — an ordinary pattern — defeats it, and per-locale build splitting is still an open feature request years in.",
      "The .inlang project format ties your catalogs to one ecosystem, and that ecosystem has form for retiring peripheral tools: the Ninja GitHub Action is deprecated and the Parrot Figma plugin is archived.",
    ],
    differences: [
      {
        title: "Locale switching without a reload",
        body: "Paraglide's v2 architecture switches locale by reloading the page — a deliberate design choice, not an oversight. Palamedes activates a new catalog in place: React components re-render through an external-store bridge, Solid through a signal. If a user can change language inside your product, that difference is not architectural trivia, it is something they feel.",
      },
      {
        title: "Catalogs the industry already speaks",
        body: "Paraglide stores messages in the .inlang project format with its own editor ecosystem around it. Palamedes writes .po — the format gettext-based CAT tools, translation agencies and most TMS products have spoken for decades — with the source string as the msgid, so a human can read the file directly and any vendor can quote on it without asking what it is.",
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
        palamedes: "Small runtime for lookup and activation",
      },
      {
        criterion: "Bundle size",
        rival: "The strong suit — tree-shaken per message",
        palamedes: "Larger; not the axis Palamedes optimizes",
      },
      {
        criterion: "Locale switching",
        rival: "Full page reload by design",
        palamedes: "In-place activation, reactive re-render",
      },
      {
        criterion: "Message identity",
        rival: "Keys, compiled to functions",
        palamedes: "message + context",
      },
      {
        criterion: "Catalog format",
        rival: ".inlang project format",
        palamedes: ".po (gettext), FCL opt-in",
      },
      {
        criterion: "Framework coverage",
        rival: "Broad, via one Vite plugin",
        palamedes: `React and Solid across ${contentStats.frameworkCount} verified meta-frameworks`,
      },
      {
        criterion: "Extract + update speed",
        rival: NO_BENCHMARK,
        palamedes: "Checked report covers Lingui, FormatJS and i18next only",
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
      "A full page reload on locale switch is acceptable, or your product switches language rarely.",
      "You want the .inlang ecosystem: Sherlock in VS Code, Fink for translators.",
      "You need framework coverage beyond React and Solid from a single plugin.",
    ],
    pickPalamedes: [
      "Users switch language in-session and a page reload would be a visible regression.",
      "Your translators or agency work in .po and you would rather not convert on every round trip.",
      "You want source strings as identity instead of a key namespace to design and defend.",
      "You want catalog audits and ICU diagnostics as part of the toolchain, not as a separate product.",
    ],
    honest:
      "Paraglide's bundle-size story is better than ours and we are not going to claim otherwise — zero runtime beats a small runtime on that axis by construction, and that is a fine reason to pick them. We spend those kilobytes on in-place locale switching and .po interoperability because we think most products get more back from those than from the bytes. Nothing in the checked benchmark harness measures Paraglide, so there is no speed claim on this page.",
  },
]

export function rivalBySlug(slug: string): Rival {
  const rival = RIVALS.find((candidate) => candidate.slug === slug)
  if (!rival) throw new Error(`rivals.ts: unknown rival ${slug}`)
  return rival
}

export const BENCH_FOOTNOTE =
  "¹ Median of 7 runs on the realistic corpus (1,500 files, ~400k lines, 6,000 messages — half the files carry no i18n marker), one machine-local run, same semantic validation for every tool. The full report and the harness are in the repository, and the site build fails if these numbers drift from it."
