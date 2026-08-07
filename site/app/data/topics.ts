/*
 * Topic landing pages — one page per problem a reader actually searches for.
 *
 * These are search-intent pages, not comparison pages, and the discipline is
 * the same as everywhere else on this site: every page is anchored to
 * something checked in the repository. If a topic has no evidence behind it,
 * it does not get a page, because a topic page without substance ranks for a
 * week and converts never.
 *
 * Deliberately absent: a page claiming Palamedes does automatic translation.
 * It does not translate anything. The honest version of that page would be
 * about running machine translation over catalogs you keep.
 */

import { BENCH_REALISTIC } from "./bench"
import contentStats from "./generated/content-stats.json"
import { docsHref } from "./links"

export interface TopicFaq {
  q: string
  a: string
}

export interface TopicPoint {
  title: string
  body: string
}

export interface TopicEvidence {
  label: string
  value: string
  note: string
}

export interface Topic {
  slug: string
  metaTitle: string
  metaDescription: string
  eyebrow: string
  headline: string
  lede: string
  /** Stated in the reader's words, before any product claim. */
  problem: { title: string; body: string; symptoms: string[] }
  answer: { title: string; lede: string; points: TopicPoint[] }
  evidence: {
    title: string
    lede: string
    items: TopicEvidence[]
    href: string
    hrefLabel: string
    /** Renders the shared benchmark chart instead of an evidence grid. */
    chart?: boolean
  }
  code?: { caption: string; label: string; code: string; note: string }
  faq: TopicFaq[]
  related: { label: string; href: string }[]
}

export const TOPICS: Topic[] = [
  {
    slug: "react-server-components-i18n",
    metaTitle: "i18n for React Server Components — without a provider or a bypass",
    metaDescription:
      "React Context cannot cross the server-component boundary, which is why most i18n libraries need a workaround in the App Router. Palamedes resolves translations through request-local scope instead, so the same code runs in an RSC, a client island and a Node handler.",
    eyebrow: "Topic · Server components",
    headline: "i18n for React Server Components, without the workaround.",
    lede: "Most JavaScript i18n libraries resolve messages through React Context. Context is a client-tree mechanism, and React Server Components removed the client tree from half your application. That mismatch is why so many App Router i18n guides contain the word 'workaround'.",
    problem: {
      title: "Why Context-based i18n breaks in the App Router",
      body: "A provider wraps a tree and passes values down through it. A server component never enters that tree — it renders on the server, before hydration, outside React's client context entirely. So a library whose lookup depends on a provider has nothing to read from, and the usual fixes are to wrap everything in a client component, duplicate the translation state on both sides, or thread a locale prop through every call site by hand.",
      symptoms: [
        "You wrapped a component in 'use client' purely so a translation hook would work.",
        "Your locale is passed as a prop through three layers of components that do not otherwise care about it.",
        "Translation state exists twice — once for server rendering, once for the client — and the two can disagree.",
        "The library's own documentation calls the App Router setup a workaround, a bypass, or experimental.",
      ],
    },
    answer: {
      title: "Resolve through request scope, not through a tree",
      lede: "Palamedes never asks React for the active instance. It asks the request.",
      points: [
        {
          title: "One accessor, everywhere",
          body: "Transformed code reaches the active i18n instance through exactly one function: getI18n(). There is no provider to mount, no second hook for server components, and no separate RSC entry point. The same component code runs unchanged in a server component, a client island, or an Express route handler.",
        },
        {
          title: "Request-local scope on the server",
          body: "On the server the active locale lives in request-local async context, so concurrent requests in different languages never see each other's state. This is the mechanism Context cannot provide and the reason no bypass is needed — the lookup was never tied to the render tree in the first place.",
        },
        {
          title: "One locale for the client document",
          body: "In the browser the same accessor is a plain getter initialized before translated UI hydrates. Locale changes navigate the document, which keeps framework state, module caches, and the server-rendered language aligned.",
        },
        {
          title: "Not a Next.js feature",
          body: `The same model runs across ${contentStats.frameworkCount} meta-frameworks, including the RSC-capable ones beyond Next.js — Waku and TanStack Start among them. Server-component support here is a property of the architecture, not an integration written for one framework.`,
        },
      ],
    },
    evidence: {
      title: "Smoke-checked on relevant changes; browser-checked weekly",
      lede: "Server-component rendering is exactly the kind of claim that is easy to assert and tedious to prove, so it is proven mechanically instead.",
      items: [
        {
          label: "Example apps",
          value: `${contentStats.smokeExampleCount}`,
          note: `${contentStats.browserExampleCount} browser-capable examples run Playwright weekly or on manual dispatch; all are built and smoke-checked on relevant PRs and main pushes — no mocked integrations.`,
        },
        {
          label: "Meta-frameworks",
          value: `${contentStats.frameworkCount}`,
          note: "Next.js, TanStack Start, SolidStart, Waku, React Router and Remix v3, each with the same runtime model.",
        },
        {
          label: "Locale strategies each",
          value: `${contentStats.strategyCount}`,
          note: "Cookie, route, subdomain and top-level domain, so the server path is exercised under every resolution mode.",
        },
        {
          label: "What CI checks",
          value: "SSR + switch",
          note: "The flow loads each app, asserts server-rendered output, switches locale, and exercises localized server actions.",
        },
      ],
      href: "/frameworks",
      hrefLabel: "See the verified framework matrix",
    },
    code: {
      caption: "The same component, on either side of the boundary.",
      label: "Server component or client island — identical code",
      code: `import { t } from "@palamedes/core/macro"

// No "use client". No provider. No locale prop.
export default async function CheckoutHeading({ seats }) {
  return <h1>{t\`Buy \${seats} seats\`}</h1>
}`,
      note: "Nothing here declares which side of the boundary it runs on, because nothing needs to. The macro compiles to a getI18n() call, and on the server that resolves against request-local scope.",
    },
    faq: [
      {
        q: "Does Palamedes work with the Next.js App Router?",
        a: "Yes, and without a bypass. Server components call the same getI18n() that client components do, backed by request-local async context. The Next.js plugin requires Next 16.",
      },
      {
        q: "Do I need a provider component?",
        a: "No. There is no provider to mount anywhere in the tree. This is the design decision that makes server components work, so it is not something that can be opted out of.",
      },
      {
        q: "How do client components get their translations?",
        a: "Through the same getI18n() accessor. In the browser it is backed by an external store in React and a signal in Solid, so activating a different catalog re-renders the components that use it, without a page reload.",
      },
      {
        q: "Does this work outside Next.js?",
        a: `Yes. The same model is verified across ${contentStats.frameworkCount} meta-frameworks in CI, including the RSC-capable ones beyond Next.js. Palamedes ships React and Solid packages; there is no Vue or React Native support.`,
      },
      {
        q: "Why can't React Intl support server components?",
        a: "Its runtime resolves messages through React Context, which is a client-tree mechanism. That is an architectural premise rather than a missing feature, which is why the request to use React Intl without Context has stayed open rather than being implemented.",
      },
    ],
    related: [
      { label: "Compare with React Intl", href: "/compare/react-intl" },
      { label: "Compare with next-intl", href: "/compare/next-intl" },
      { label: "The verified framework matrix", href: "/frameworks" },
    ],
  },
  {
    slug: "i18n-performance",
    metaTitle: `i18n extraction performance — ${BENCH_REALISTIC.ratios.lingui} faster on a checked benchmark`,
    metaDescription:
      "Message extraction runs on every build and every pre-commit hook, and on a large codebase it is seconds each time. Palamedes runs extraction and catalog merging in a Rust core, with a benchmark you can re-run yourself.",
    eyebrow: "Topic · Performance",
    headline: "Extraction should not be the slow part of your build.",
    lede: "Extraction reads your entire source tree, parses it, and reconciles what it finds against every catalog you ship. Most tooling does that in JavaScript, once per build and again on every pre-commit hook. On a real codebase that is seconds of waiting, several times an hour, for a step nobody thinks about until it hurts.",
    problem: {
      title: "Where the time actually goes",
      body: "Extraction is compiler work: parse every file, find the messages, understand their structure, then merge the result into existing catalogs without losing translations. Doing that in JavaScript means paying parse costs in the slowest part of the toolchain, on a workload that grows with your repository rather than with your feature.",
      symptoms: [
        "Your pre-commit hook takes long enough that people start using --no-verify.",
        "Extraction is a separate CI step with its own minutes on the bill.",
        "Someone has already suggested running extraction 'only on main' to save time.",
        "Adding a locale made everything measurably slower.",
      ],
    },
    answer: {
      title: "One native engine, doing all of it",
      lede: "Parsing, extraction, catalog merging, audits and ICU diagnostics run in a single Rust core rather than across a stack of JavaScript plugins.",
      points: [
        {
          title: "Native parsing, not convention scanning",
          body: "Messages are found by parsing your source, so the result is exact rather than heuristic — and the parse happens in native code rather than in the JavaScript layer that has to be loaded and warmed first.",
        },
        {
          title: "Merging is part of the same pass",
          body: "The benchmark measures the workflow you actually run — extract and update — not extraction alone. Catalog-aware tools also reconcile existing per-locale catalogs, which is where a naive implementation loses translations or spends its time.",
        },
        {
          title: "Consistent semantics as a side effect",
          body: "The useful consequence is not only speed. Because one engine owns catalog semantics, an audit result cannot depend on which adapter asked for it — the same rules apply from the CLI, the Vite plugin and the Next.js plugin.",
        },
      ],
    },
    evidence: {
      title: "The number, and how to reproduce it",
      lede: `Median of ${7} runs on a realistic corpus — ${BENCH_REALISTIC.corpus} — with the same semantic validation applied to every tool. The report and the harness are checked into the repository, and the site build fails if these figures drift from it.`,
      items: [],
      chart: true,
      href: docsHref("benchmark-e2e-workflow"),
      hrefLabel: "Read the method and re-run it",
    },
    faq: [
      {
        q: "How was this measured?",
        a: `Median of seven runs on a realistic corpus of ${BENCH_REALISTIC.corpus}, one machine-local run, with the same logical message inventory and the same semantic validation for every tool. The harness and the full report are in the repository so you can re-run both.`,
      },
      {
        q: "Will I see the same numbers?",
        a: "Almost certainly not — these are machine-local figures from one machine, not an average. Your hardware will differ. The ratios between tools are the signal, and running the harness on your own hardware is the honest way to check them.",
      },
      {
        q: "Does the benchmark include catalog merging?",
        a: "Yes, and that matters for reading it fairly. The catalog-aware tools extract and then update existing per-locale catalogs. The React Intl extraction workflow writes a single aggregated message file instead, so it is doing less work in the same row.",
      },
      {
        q: "Which tools are covered?",
        a: "Lingui, React Intl, i18next-cli and General Translation. Tools the harness has not measured are not given a speed claim anywhere on this site, because a guess dressed as a benchmark is worse than no number.",
      },
      {
        q: "Does faster extraction mean a smaller bundle?",
        a: "No, and the two should not be conflated. This is build-time performance. On runtime bundle size a zero-runtime compiler like Paraglide beats a runtime layer by construction, and we say so on the page comparing the two.",
      },
    ],
    related: [
      { label: "See the full proof page", href: "/proof" },
      { label: "Compare with Lingui", href: "/compare/lingui" },
      { label: "Compare with i18next", href: "/compare/i18next" },
    ],
  },
  {
    slug: "icu-messageformat",
    metaTitle: "ICU MessageFormat in JavaScript — proven from source to runtime",
    metaDescription:
      "Plenty of libraries say they support ICU MessageFormat. Palamedes ships an executable proof that nested plural and select selectors survive extraction, PO catalogs, compilation and rendering unchanged.",
    eyebrow: "Topic · ICU",
    headline: "'Supports ICU' is not a yes-or-no answer.",
    lede: "ICU MessageFormat is how you write a sentence that stays grammatical when the number changes, when the gender changes, or when both change at once. Nearly every library claims support. What varies is how much of that survives the trip from your source file, through a catalog, through a build step, to the string a user reads.",
    problem: {
      title: "Where ICU quietly stops working",
      body: "A message with a plural nested inside a select passes through several systems before it renders: an extractor, a catalog format, a translation tool, a compiler, and a runtime. Each one can flatten, re-order or drop a selector branch. Nothing errors — the message simply renders the wrong branch in one locale, and you find out from a support ticket.",
      symptoms: [
        "A plural form renders correctly in English and wrongly in a language with more plural categories.",
        "Your ICU support arrived as a plugin that replaced the library's own interpolation format.",
        "A translation tool round-tripped your catalog and the nested selectors came back flattened.",
        "Nobody on the team can say with confidence which ICU features actually work end to end.",
      ],
    },
    answer: {
      title: "One vocabulary, and a proof that it survives",
      lede: "Palamedes is ICU MessageFormat throughout — not as an opt-in plugin, and not as a house dialect with ICU available as a setting.",
      points: [
        {
          title: "ICU is the format, not an adapter",
          body: "The same syntax you write in a macro is the syntax in the .po catalog and the syntax the runtime evaluates. There is no translation between an internal representation and ICU, because there is no internal representation.",
        },
        {
          title: "Nested selectors are the test case, not the edge case",
          body: "The checked fixture exercises plural nested inside select — the combination that breaks first — across extraction, macro transformation, catalog update, compilation and six executions of the transformed runtime function.",
        },
        {
          title: "Unsupported formatters fail loudly",
          body: "Palamedes supports fewer runtime formatter kinds than full ICU. The compiler reports the unsupported ones as errors at build time rather than rendering something plausible and wrong at three in the morning.",
        },
        {
          title: "The claim stops at our boundary",
          body: "This proves every stage Palamedes controls. A translation platform is an external boundary — what survives an import and export there depends on the product, the format and the project settings, and no honest table can claim otherwise.",
        },
      ],
    },
    evidence: {
      title: "An executable proof, not a checkbox",
      lede: "The proof is a fixture in the repository. It compares exact messages and selector structure at each stage rather than asserting that ICU is 'supported'.",
      items: [
        {
          label: "What it exercises",
          value: "Nested select + plural",
          note: "The combination that fails first in pipelines that only claim ICU support.",
        },
        {
          label: "Stages covered",
          value: "5",
          note: "Extraction, macro transformation, PO catalog update, catalog compilation, runtime rendering.",
        },
        {
          label: "Runtime executions",
          value: "6",
          note: "The transformed function is executed across selector combinations and compared against expected output.",
        },
        {
          label: "Where it runs",
          value: "In CI",
          note: "Checked in, re-runnable locally, and failing the build when a stage stops preserving structure.",
        },
      ],
      href: docsHref("icu-semantics-proof"),
      hrefLabel: "Inspect and re-run the ICU proof",
    },
    code: {
      caption: "A nested selector, written the way it renders.",
      label: "Plural inside select",
      code: `import { plural, select } from "@palamedes/core/macro"

select(gender, {
  female: plural(count, {
    one: "She invited one guest",
    other: "She invited # guests",
  }),
  other: plural(count, {
    one: "They invited one guest",
    other: "They invited # guests",
  }),
})`,
      note: "This structure is what lands in the .po catalog and what the runtime evaluates. The proof asserts that all three representations still agree after a full round trip.",
    },
    faq: [
      {
        q: "What is ICU MessageFormat?",
        a: "A standard syntax for messages whose wording depends on their data — plural categories, gendered select branches, ordinals, and number and date formatting. It is maintained as part of the International Components for Unicode and is understood well beyond JavaScript, which is what makes a translation vocabulary portable.",
      },
      {
        q: "Does Palamedes support nested plural inside select?",
        a: "Yes, and that specific combination is what the checked proof exercises, because it is the one that breaks first when a pipeline only claims ICU support.",
      },
      {
        q: "Which ICU features are not supported?",
        a: "Palamedes supports fewer runtime formatter kinds than full ICU. The compiler reports unsupported formatters as build errors rather than failing silently, so you find out before shipping rather than after — but you should check your own catalog against that surface before migrating.",
      },
      {
        q: "Do .po catalogs preserve ICU structure?",
        a: "Yes. The ICU string is the message, and the source string is the msgid, so a translator or a gettext-based tool sees exactly what the runtime will evaluate.",
      },
      {
        q: "Is ICU the same as i18next's interpolation format?",
        a: "No. i18next ships its own {{variable}} syntax and offers ICU through a plugin that replaces it. Both work; only one of them is a cross-platform standard your translation vendor already understands.",
      },
    ],
    related: [
      { label: "Compare with React Intl", href: "/compare/react-intl" },
      { label: "Compare with i18next", href: "/compare/i18next" },
      { label: "See the full proof page", href: "/proof" },
    ],
  },
  {
    slug: "locale-routing",
    metaTitle: "Locale routing strategies — cookie, path, subdomain and domain compared",
    metaDescription:
      "Cookie, route prefix, subdomain or country domain: four ways to put a locale in a URL, with different consequences for SEO, caching and infrastructure. Each one is verified in a browser across six meta-frameworks.",
    eyebrow: "Topic · Routing",
    headline: "Four ways to carry a locale. They are not interchangeable.",
    lede: "Where the locale lives — a cookie, a path prefix, a subdomain, or a separate country domain — decides how search engines index you, how your CDN caches you, and how much infrastructure you have to own. It is one of the earliest decisions in an i18n project and one of the most expensive to reverse.",
    problem: {
      title: "The decision people make by accident",
      body: "Most teams pick a strategy from whichever tutorial they read first, then discover the consequences at the point where changing it means rewriting URLs that are already indexed. The four options differ on shareability, on how cleanly a CDN can cache each variant, on how much DNS and certificate work you take on, and on whether a search engine can even see the localized versions.",
      symptoms: [
        "Your localized pages are not indexed separately, because the locale is only in a cookie.",
        "Sharing a link sends the recipient to the wrong language.",
        "Your CDN caches one variant and serves it to everyone.",
        "You need per-country domains for a market and your i18n layer assumes path prefixes.",
      ],
    },
    answer: {
      title: "Headless controls, and your router keeps the URLs",
      lede: "Palamedes deliberately does not own routing. It resolves the locale and gives you the controls; the URL structure stays with the framework you already chose.",
      points: [
        {
          title: "Resolution is separate from routing",
          body: "Locale resolution, the deliberate-choice cookie and canonical URL helpers are headless. That means the same translation setup works whether the locale arrives in a path segment, a subdomain, a domain or a cookie — and changing strategy later does not touch your messages.",
        },
        {
          title: "Your router stays framework-native",
          body: "There is no wrapped Link, no proprietary navigation layer and no middleware you inherit from us. You wire slightly more at the start; in exchange you keep your routing knowledge, and moving framework does not mean relearning navigation.",
        },
        {
          title: "Every strategy is exercised, not just documented",
          body: `Each of the six server frameworks has an example app for all four strategies. All ${contentStats.smokeExampleCount} examples are smoke-checked on relevant PRs and main pushes; ${contentStats.browserExampleCount} browser-capable examples run the real-browser contract weekly or on manual dispatch. The tradeoffs below are written from apps that run, not from a table someone maintained by hand.`,
        },
      ],
    },
    evidence: {
      title: "The four strategies, and what each one costs",
      lede: `All four are implemented for every server framework and smoke-checked across ${contentStats.smokeExampleCount} examples. The ${contentStats.browserExampleCount} browser-capable examples run Playwright weekly or on manual dispatch. The differences are real and worth reading before you commit.`,
      items: [
        {
          label: "Cookie",
          value: "One URL",
          note: "Simplest to run, but a shared link carries no language and search engines see a single page per route.",
        },
        {
          label: "Route prefix",
          value: "/de/…",
          note: "The pragmatic default: indexable, shareable, no DNS work, and it fits inside one deployment.",
        },
        {
          label: "Subdomain",
          value: "de.example.com",
          note: "Clean separation and per-locale caching, at the cost of DNS records and wildcard certificates.",
        },
        {
          label: "Country domain",
          value: "example.de",
          note: "Strongest local signal and the most infrastructure — one domain, one certificate, one deployment target per market.",
        },
      ],
      href: docsHref("locale-strategies"),
      hrefLabel: "Read the strategy guide",
    },
    faq: [
      {
        q: "Which locale routing strategy is best for SEO?",
        a: "A route prefix or a separate domain, because both give every language a distinct, indexable URL. A cookie-only strategy does not — search engines see one URL per route and cannot index the localized variants separately. Country domains give the strongest regional signal but cost the most to operate.",
      },
      {
        q: "Subdomain or path prefix?",
        a: "A path prefix keeps everything in one deployment with no DNS work and is the pragmatic default for most teams. Subdomains buy cleaner per-locale caching and isolation, and cost you DNS records plus a wildcard certificate.",
      },
      {
        q: "Can I change strategy later?",
        a: "The translation side is unaffected — messages, catalogs and identity do not depend on where the locale lives. What is expensive is the URLs themselves, since anything already indexed or shared needs redirects. That is why the decision is worth making deliberately.",
      },
      {
        q: "Does Palamedes provide the routing?",
        a: "No, on purpose. You get headless locale resolution, a deliberate-choice cookie and canonical URL helpers; your framework's router owns the URLs. If you want localized pathnames as a library feature, next-intl covers that ground and we say so on the page comparing the two.",
      },
      {
        q: "How do I know these actually work?",
        a: `Every strategy has a running example app per framework — ${contentStats.smokeExampleCount} in total — built and smoke-checked against the workspace packages on relevant PRs and main pushes. ${contentStats.browserExampleCount} browser-capable examples run Playwright weekly or on manual dispatch, with versioned screenshots checked into the repository.`,
      },
    ],
    related: [
      { label: "The verified framework matrix", href: "/frameworks" },
      { label: "Compare with next-intl", href: "/compare/next-intl" },
      { label: "Start the quickstart", href: "/get-started" },
    ],
  },
]

export function topicBySlug(slug: string): Topic {
  const topic = TOPICS.find((candidate) => candidate.slug === slug)
  if (!topic) throw new Error(`topics.ts: unknown topic ${slug}`)
  return topic
}
