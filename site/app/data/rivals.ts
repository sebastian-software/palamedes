/*
 * Per-rival comparison content for the /compare/* landing pages.
 *
 * Ground rules for everything in this file, in order of importance:
 *
 * 1. Every factual claim about another project comes from the dated research
 *    notes in docs/research/competitors/frameworks/ — `researched` carries
 *    that date so the page can say when it was true.
 * 2. `respect` is not a courtesy paragraph. It states, in their terms, what
 *    the other project is genuinely better at. A comparison that cannot name
 *    the other side's strengths is not worth reading.
 * 3. Benchmark numbers appear only where a checked report actually measured
 *    that tool (see bench.ts / verify-site-bench-data.mjs). Where nothing was
 *    measured, the page says so instead of implying a win.
 * 4. `honest` names a real Palamedes limitation against that rival — not a
 *    humblebrag.
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
  respectTitle: string
  respect: string[]
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
  "Not measured. The checked benchmark harness covers Lingui, FormatJS, and the two i18next extractors; anything else would be a guess."

export const RIVALS: Rival[] = [
  {
    slug: "lingui",
    name: "Lingui",
    subject: "@lingui/core 6.5.0",
    researched: "July 2026",
    metaTitle: "Palamedes vs Lingui — the same idea, taken further",
    metaDescription:
      "Lingui and Palamedes share the same authoring instinct: macros in your components, source strings as identity, .po catalogs. Here is where Palamedes goes further — and where Lingui is still the safer pick.",
    eyebrow: "Compare · Lingui",
    headline: "The same idea. One layer deeper.",
    lede: "Lingui got the model right: write the message where the UI happens, let the source string be the identity, keep catalogs translators already know. Palamedes agrees with all of it — and rebuilds the machinery underneath in Rust, with one runtime model instead of several.",
    card: "The closest relative: same authoring model, rebuilt on a native core with one runtime path.",
    facts: [
      { label: "Adoption", value: "~1.29M downloads/week" },
      { label: "Track record", value: "Since 2017" },
      { label: "Catalogs", value: ".po, native" },
      { label: "Identity", value: "Source string or explicit ID" },
    ],
    respectTitle: "What Lingui does well",
    respect: [
      "Nine years of production track record — Lingui shipped this authoring model long before most of the current React i18n tooling existed.",
      "Genuinely broad framework support: React, React Native, Vue 3, SolidJS and vanilla JS are all first-party, not ports.",
      "Native ICU MessageFormat and first-class .po catalogs, so existing translator tooling works without adapters.",
      "Active investment in build performance — worker-thread parallel extraction and experimental Rolldown-based extraction are real engineering, not marketing.",
    ],
    differences: [
      {
        title: "One runtime model, not several entry points",
        body: "Palamedes exposes exactly one way for transformed code to reach the active instance: getI18n(). No provider tree to thread, no second hook for server components, no separate path for RSC. The same call works in a Next.js server component, a Solid island, and an Express handler.",
      },
      {
        title: "Catalog semantics in one native engine",
        body: "Parsing, updating, auditing, ICU diagnostics and artifact compilation all live in one Rust core (ferrocat), not spread across JS plugins. That is where the extraction speed comes from — and, more usefully, why the same catalog semantics apply no matter which adapter called them.",
      },
      {
        title: "message + context, and nothing else",
        body: "Lingui lets you choose between source-derived IDs and explicit custom IDs. Palamedes deliberately does not offer the second path: identity is the source string plus optional context, full stop. Fewer choices, but no project ever splits into two identity conventions.",
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
        palamedes: "message + context only",
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
        palamedes: "New — the tradeoffs are written down, the track record is not there yet",
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
      note: "If your Lingui code already avoids explicit IDs, most of it reads identically after the import swap. The work in a migration is in the catalogs and the runtime wiring, not in your components.",
    },
    pickRival: [
      "You need Vue or React Native — Palamedes has neither.",
      "You depend on a Lingui plugin or TMS integration that has no Palamedes equivalent yet.",
      "You want the option of explicit message IDs for a subset of your catalog.",
      "Years of production track record outweigh build performance for your team.",
    ],
    pickPalamedes: [
      "Extraction time has become a real cost in your build or pre-commit hook.",
      "You want exactly one runtime access model across server components, client islands and backend code.",
      "You want catalog semantics, audits and ICU diagnostics to come from one engine instead of several layers.",
      "You are on React or Solid and expect to change meta-framework at some point.",
    ],
    honest:
      "Lingui got here first and has the production mileage to show for it. Palamedes is younger, has a smaller ecosystem, and covers fewer UI frameworks. What it offers instead is a narrower model and a faster engine — and every tradeoff behind that is written down in the ADRs before you commit to anything.",
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
    metaTitle: "Palamedes vs i18next — source strings instead of key management",
    metaDescription:
      "i18next is the most widely deployed i18n stack in JavaScript. Palamedes takes the opposite position on one question: what identifies a message. Here is what that changes, and when i18next remains the better fit.",
    eyebrow: "Compare · i18next",
    headline: "You already know what the string says.",
    lede: "i18next identifies messages by keys you invent and maintain. Palamedes identifies them by the source text you already wrote. That one decision changes what a missing translation looks like, what your translators receive, and how much naming work your team does every week.",
    card: "The ecosystem giant. The split is one question: do keys identify your messages, or does the text?",
    facts: [
      { label: "Adoption", value: "~18.2M downloads/week" },
      { label: "Track record", value: "Since 2011" },
      { label: "Catalogs", value: "JSON, key-based" },
      { label: "Identity", value: "Keys you maintain" },
    ],
    respectTitle: "What i18next does well",
    respect: [
      "The broadest reach in the ecosystem by a wide margin — 14 years of production use and an install base no alternative comes close to.",
      "A modular plugin architecture covering nearly every backend, detector and bundler combination you are likely to need.",
      "Genuinely framework-agnostic: the same core runs in React, Vue, Angular, Node, Deno and beyond, with ports outside JavaScript entirely.",
      "A funding model that has kept the project maintained for over a decade without a corporate owner or foundation behind it.",
    ],
    differences: [
      {
        title: "A missing translation still reads like a sentence",
        body: "When a key-based lookup misses, the UI shows the raw key — checkout.button.buy in front of a user. Palamedes falls back to the source string, so the worst case is untranslated English rather than a broken-looking identifier. The fallback is the message you already wrote.",
      },
      {
        title: "No naming layer to maintain",
        body: "Key-based workflows ask every developer to invent, namespace and remember identifiers, and to keep them in sync with a JSON tree. Source-string identity removes that layer: you write the sentence, extraction finds it, and context disambiguates the rare collision.",
      },
      {
        title: "ICU is the format, not a plugin",
        body: "i18next ships its own interpolation syntax and treats ICU MessageFormat as an opt-in plugin that replaces it. Palamedes is ICU throughout — the same nested plural and select semantics travel from your source through the catalog to the runtime, with a checked proof that they survive the trip.",
      },
      {
        title: "Extraction is a compile step",
        body: `Palamedes extracts by parsing your source in a Rust core rather than by convention. On the checked realistic corpus that difference is measurable against both i18next extractors: ${speedup("i18next-parser")} for i18next-parser, ${speedup("i18next-cli")} for i18next-cli.¹`,
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
        rival: "The raw key",
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
        palamedes: "Native, end to end",
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
      note: "With i18next the JSON file is the source of truth and the component references it. With Palamedes the component is the source of truth and the catalog is generated from it.",
    },
    pickRival: [
      "You need i18n outside React and Solid — Angular, Vue, jQuery or plain Node.",
      "You depend on the plugin ecosystem: specific backends, detectors, or post-processors.",
      "Your team genuinely prefers key-based catalogs and has the conventions to keep them clean.",
      "You want the largest possible pool of tutorials, answers and hire-able experience.",
    ],
    pickPalamedes: [
      "Key maintenance has become a chore, or raw keys have leaked into production UI.",
      "Your translators would rather receive .po files than nested JSON.",
      "You want ICU semantics guaranteed end to end rather than swapped in via plugin.",
      "Extraction time matters in CI, and you are on React or Solid.",
    ],
    honest:
      "i18next is the default for good reasons, and no benchmark changes that. It reaches frameworks Palamedes does not support, its plugin ecosystem has no equivalent here, and there is no migration playbook from i18next yet — moving a key-based catalog to source-string identity is real work you would be doing largely by hand today.",
  },
  {
    slug: "next-intl",
    name: "next-intl",
    subject: "next-intl 4.13.1",
    researched: "July 2026",
    metaTitle: "Palamedes vs next-intl — Next-native depth vs framework portability",
    metaDescription:
      "next-intl is the most Next.js-idiomatic i18n library there is, routing included. Palamedes trades that depth for a model that survives a framework change. An honest look at both sides.",
    eyebrow: "Compare · next-intl",
    headline: "Depth in one framework, or one model across five.",
    lede: "next-intl is built into Next.js as far as a library can be — localized pathnames, domain routing and RSC integration are the product, not add-ons. Palamedes deliberately owns less: your framework keeps routing, and the translation model stays the same when the framework changes.",
    card: "Next-native depth including routing, against a model that survives a framework change.",
    facts: [
      { label: "Adoption", value: "~4.0M downloads/week" },
      { label: "Scope", value: "Next.js (use-intl for plain React)" },
      { label: "Catalogs", value: "JSON, key-based" },
      { label: "Routing", value: "Core feature" },
    ],
    respectTitle: "What next-intl does well",
    respect: [
      "The deepest App Router and RSC integration in the field — widely treated as the de facto standard for Next.js i18n.",
      "Locale routing is part of the product: middleware, domain routing and localized pathnames work out of the box, which is real work you would otherwise write yourself.",
      "A strong type-safety story, with TypeScript augmentation of message keys and optionally of ICU argument shapes.",
      "Standards-based ICU and ECMA-402 formatting for dates, numbers, lists and relative time in one coherent package.",
    ],
    differences: [
      {
        title: "Routing stays with your framework",
        body: "This is a genuine tradeoff, not a feature gap we are spinning. next-intl gives you localized routing as part of the library. Palamedes gives you headless locale controls — resolution, the deliberate-choice cookie, canonical URLs — and leaves routing to your router. You wire a little more; you also keep the wiring when you move.",
      },
      {
        title: "The model outlives the framework choice",
        body: `Palamedes runs the same runtime and identity model across Next.js, TanStack Start, SolidStart, Waku, React Router and Remix v3, with ${contentStats.exampleCount} verified example apps in CI covering ${contentStats.strategyCount} locale strategies each. next-intl outside Next.js means dropping to use-intl and rebuilding the routing and RSC integration yourself.`,
      },
      {
        title: "Source strings, not generated keys",
        body: "next-intl's stable path is key-based JSON. Its experimental extraction workflow does compile source strings — but writes a generated hash into the PO msgid, which inverts the gettext convention translators rely on. Palamedes keeps the source string as the msgid, because that is what makes a .po file readable without tooling.",
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
        criterion: "Catalog format",
        rival: "JSON; PO only in the experimental workflow",
        palamedes: ".po with the source string as msgid",
      },
      {
        criterion: "Server components",
        rival: "First-class",
        palamedes: "First-class, same getI18n() as everywhere else",
      },
      {
        criterion: "Extract + update speed",
        rival: NO_BENCHMARK,
        palamedes: "Checked report covers Lingui, FormatJS and i18next only",
      },
      {
        criterion: "Maintenance",
        rival: "Single maintainer, large adoption",
        palamedes: "Company-maintained, small and new",
      },
    ],
    code: {
      caption: "Both are ICU underneath. The difference is what you name.",
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
      note: "next-intl asks you to name a namespace and a key. Palamedes asks you to write the sentence. Both compile to ICU; only one of them adds a naming step.",
    },
    pickRival: [
      "You are all-in on Next.js and have no plan to change that.",
      "You want localized pathnames or domain routing without writing the routing layer yourself.",
      "Your team prefers message files with keys as the source of truth.",
      "You want the most Next-idiomatic API available, including its typed message keys.",
    ],
    pickPalamedes: [
      "You run more than one meta-framework, or expect to.",
      "You want .po catalogs your translators can read without a converter.",
      "You want message identity that does not depend on someone naming things well.",
      "You want the routing layer to stay yours, framework-native and unwrapped.",
    ],
    honest:
      "If Next.js is your only target and routing is part of what you want from an i18n library, next-intl is the better fit and this page will not pretend otherwise. Palamedes covers less of that surface on purpose — and its own Next.js support requires Next 16, where next-intl reaches further back.",
  },
  {
    slug: "react-intl",
    name: "FormatJS / react-intl",
    subject: "react-intl 10.1.14",
    researched: "July 2026",
    metaTitle: "Palamedes vs react-intl — ICU rigor with a server-component story",
    metaDescription:
      "react-intl is the ICU standard-bearer in JavaScript. Palamedes keeps the ICU rigor but drops the provider tree, which is what makes server components work without a bypass.",
    eyebrow: "Compare · FormatJS",
    headline: "Keep the ICU rigor. Lose the provider.",
    lede: "react-intl set the standard for ICU MessageFormat in JavaScript, and Palamedes does not argue with the format — it argues with the plumbing. A Context-based runtime is what makes React Server Components a workaround rather than a supported path.",
    card: "The ICU standard-bearer. Same rigor here, minus the Context tree that blocks server components.",
    facts: [
      { label: "Adoption", value: "~3.1M downloads/week" },
      { label: "Track record", value: "~12 years" },
      { label: "Catalogs", value: "Custom JSON" },
      { label: "Identity", value: "Content-hash IDs" },
    ],
    respectTitle: "What react-intl does well",
    respect: [
      "The reference implementation for ICU MessageFormat in JavaScript — plurals, select, selectordinal, rich text and full number and date skeletons, done properly.",
      "Standards-based to the core: ICU and ECMA-402 are cross-platform, which keeps your translation vocabulary portable well beyond JavaScript.",
      "Ships its own Intl.* polyfill packages, which still matters for environments with incomplete ECMA-402 support.",
      "TMS-agnostic by design, with pluggable formatter adapters for most vendor workflows, plus an optional AST precompilation path for runtime performance.",
    ],
    differences: [
      {
        title: "No Context means server components just work",
        body: "react-intl resolves messages through React Context, which is structurally incompatible with React Server Components — App Router setups need a bypass. Palamedes resolves through getI18n(), backed by request-local async context on the server. The same component code runs in an RSC, a client island, or an Express route.",
      },
      {
        title: "Editing a string does not orphan its translations",
        body: "FormatJS derives message IDs from a content hash of the default message, so fixing a typo changes the ID and can orphan existing translations unless your tooling diffs for it. Palamedes uses the source string plus context as the identity and resolves updates through semantic catalog merging, which is built to survive edits.",
      },
      {
        title: "Macros instead of component boilerplate",
        body: "FormattedMessage wrapping every string is explicit but verbose. Palamedes macros compile away: you write a tagged template or a <Trans> with real JSX children, and the transform produces the runtime call. Same ICU output, less ceremony in the file you actually read.",
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
      note: "The FormatJS scope note is worth keeping in mind for the benchmark row: FormatJS extracts and writes one aggregated message file, while the other tools also merge and update per-locale catalogs.",
    },
    pickRival: [
      "You need Intl.* polyfills for environments without full ECMA-402 support.",
      "Your app is client-components-only and the Context model causes you no friction.",
      "You rely on an established FormatJS formatter adapter for your TMS.",
      "You want the library with the strongest claim to being the ICU reference in JS.",
    ],
    pickPalamedes: [
      "You are on the App Router or another RSC-first framework and want i18n without a bypass.",
      "You want .po catalogs instead of a custom JSON format.",
      "Message edits should not risk orphaning translations.",
      "You want less per-string boilerplate without giving up ICU.",
    ],
    honest:
      "react-intl has the deeper ICU pedigree and a polyfill story Palamedes simply does not have. If your runtime targets need those polyfills, this is not a close call. Palamedes also supports fewer formatter kinds at runtime than full ICU — the compiler reports the unsupported ones as errors rather than failing quietly, but it is a smaller surface.",
  },
  {
    slug: "paraglide",
    name: "Paraglide (inlang)",
    subject: "@inlang/paraglide-js 2.20.2",
    researched: "July 2026",
    metaTitle: "Palamedes vs Paraglide — bundle size vs live locale switching",
    metaDescription:
      "Paraglide compiles messages into tree-shakable functions with no runtime library. Palamedes keeps a small runtime and gets reactive locale switching plus .po catalogs for it. A tradeoff worth understanding before you pick.",
    eyebrow: "Compare · Paraglide",
    headline: "A real tradeoff, not a feature race.",
    lede: "Paraglide compiles each message into its own tree-shakable function and ships no i18n runtime at all. Palamedes keeps a small runtime — and gets locale switching without a page reload, .po catalogs, and source strings as identity in exchange. Which side wins depends on what you are optimizing.",
    card: "Zero runtime and smaller bundles against in-place locale switching and .po catalogs.",
    facts: [
      { label: "Adoption", value: "~358k downloads/week" },
      { label: "Architecture", value: "Compile-time codegen" },
      { label: "Catalogs", value: ".inlang project format" },
      { label: "Locale switch", value: "Full page reload by design" },
    ],
    respectTitle: "What Paraglide does well",
    respect: [
      "A genuinely zero-runtime architecture: messages become plain ESM functions, so unused ones are tree-shaken away entirely.",
      "The bundle-size advantage is real and documented — their own comparison cites 47 KB against i18next's 205 KB for a five-locale example, and independent write-ups report reductions of the same order.",
      "Excellent generated TypeScript: autocomplete and compile-time errors for message keys and parameters without hand-written declarations.",
      "Broad framework coverage through a single Vite plugin, plus a shared .inlang format with a VS Code extension and a web editor for non-technical translators.",
    ],
    differences: [
      {
        title: "Locale switching without a reload",
        body: "Paraglide's v2 architecture switches locale by reloading the page — a deliberate design choice, not an oversight. Palamedes activates a new catalog in place: React components re-render through an external-store bridge, Solid through a signal. If your product switches language in-session, that difference is visible to users.",
      },
      {
        title: "Catalogs your translators already know",
        body: "Paraglide stores messages in the .inlang project format, with its own editor ecosystem around it. Palamedes writes .po — the format gettext-based CAT tools, translation agencies and most TMS products have spoken for decades, with the source string as the msgid so a human can read the file directly.",
      },
      {
        title: "Source strings instead of keys",
        body: "Paraglide messages are key-based: you call m.checkout_buy(). Palamedes keeps the sentence in the component and derives identity from it, so there is no key namespace to design and a missing translation degrades to readable English rather than an identifier.",
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
      note: "Paraglide's call site is a typed function with an autocompleted name. Palamedes' call site is the sentence. Both are compile-time; they disagree about what belongs in the component.",
    },
    pickRival: [
      "Bundle size is your primary constraint — Paraglide wins that axis, clearly.",
      "A full page reload on locale switch is acceptable, or your product switches language rarely.",
      "You want the .inlang ecosystem: Sherlock in VS Code, Fink for translators.",
      "You need framework coverage beyond React and Solid from one plugin.",
    ],
    pickPalamedes: [
      "Users switch language in-session and a page reload would be a visible regression.",
      "Your translators or agency work in .po and you would rather not convert.",
      "You want source strings as identity instead of a key namespace to design.",
      "You want catalog audits and ICU diagnostics as part of the toolchain.",
    ],
    honest:
      "Paraglide's bundle-size story is genuinely better than ours, and we are not going to claim otherwise — a zero-runtime architecture beats a small runtime on that axis by construction. Palamedes trades those kilobytes for in-place locale switching and .po interoperability. Nothing in the checked benchmark harness measures Paraglide, so there is no speed claim on this page.",
  },
]

export function rivalBySlug(slug: string): Rival {
  const rival = RIVALS.find((candidate) => candidate.slug === slug)
  if (!rival) throw new Error(`rivals.ts: unknown rival ${slug}`)
  return rival
}

export const BENCH_FOOTNOTE =
  "¹ Median of 7 runs on the realistic corpus (1,500 files, ~400k lines, 6,000 messages — half the files carry no i18n marker), one machine-local run, same semantic validation for every tool. The full report and the harness are in the repository."
