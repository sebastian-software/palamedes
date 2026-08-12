# Homepage Revamp — Concept Draft

Working document for the palamedes.dev homepage revamp. Structure and copy
level only — no visual design yet. Everything here respects the brand rules in
[PRODUCT.md](../PRODUCT.md) (Swiss Spec Grid, receipts for every number) and
the data-honesty guards in [site/README.md](README.md).

Status: revised after first feedback round — "calm" dropped from the headline
(hard for non-native readers), FAST moved to the last position, tile and
section order aligned to the new word order. Numbers quoted below are the current
guarded values from `app/data/bench.ts` and `content-stats.json`; in the mock
they appear as variables so the drift guards keep working.

---

## 1. Current-state audit (marketing lens)

What the homepage does today: hero (architecture claim + feature paragraph +
2 CTAs + QuickInstall + TerminalCascade), ProofStrip, then six numbered
sections: Model → Workflow → Proof → Scope → Maintainer → Packages → CTA.

### What works — keep

- **Proof discipline.** Drift-guarded benchmark numbers, the framework matrix,
  warm/cold honesty, ADR links. This is the moat; no revamp may weaken it.
- **ProofStrip** directly under the hero: receipts within the first scroll,
  exactly what PRODUCT.md demands.
- **Calm brand voice** and the one-accent Swiss grid. The revamp gets louder
  in _claim structure_, not in decoration.
- **QuickInstall + 5-minute CTA**: low activation energy, correct.

### What underperforms — the actual revamp targets

1. **The hero sells the architecture, not the payoff.** "One translation
   model. From source to runtime." describes _how_ Palamedes is built. The
   _why-better_ — the thing a skeptical visitor must get in 5 seconds — is
   nowhere above the fold.
2. **The strongest narrative asset is missing from the page.** The README has
   it: _"Most i18n stacks eventually ask teams to choose between convenience,
   speed, and clarity."_ That trilemma is precisely Sebastian's tri-construct
   (Performance + Tools + DX) — and it only lives in the README today.
3. **The hero paragraph is a feature enumeration.** Seven framework names in
   the first body text = curse of knowledge + cognitive load. Frameworks are
   proof, not pitch.
4. **"What you get" is scattered.** Model (01), Workflow (02), and Packages
   (06) each carry a slice of "everything included". Packages are framed as an
   npm inventory — a reference table, not persuasion.
5. **Performance is under-leveraged.** The single most quantified
   differentiator (29.57× vs Lingui, cold; 33 ms warm re-extract) first
   appears as one small stat cell, and the chart sits in section 03.
6. **Section order is architecture-first, not benefit-first.** Model →
   Workflow is how the maintainer thinks; visitors need outcome → proof →
   mechanism.

---

## 2. Core narrative: the trilemma → "Pick three."

The tri-construct becomes the page spine — not as three parallel feature
columns, but as a **dissolved trilemma**, with one headline word per piece:
CLEAR (DX) · COMPLETE (tooling) · FAST (performance):

> Every i18n stack makes you trade between speed, scope, and developer
> experience. Palamedes is built so you stop trading.

Why this frame wins:

- **It states why-better, not just what.** Three claims, each with a receipt,
  plus a mechanism that explains why all three are possible at once — which is
  what a skeptical developer will immediately ask.
- **"Pick three" is native dev culture** ("fast, good, cheap — pick two").
  It's a bold marketing hook that costs zero credibility because every piece
  links to checked-in evidence.
- **The puzzle metaphor gets a job.** The three pieces interlock _because_
  they are cut from one model. The hero figure doubles as the architecture
  diagram later on the page — the metaphor pays off twice.

### The three pieces, each with its receipt

| #   | Word     | Piece                | Claim                                                                                                                  | Receipt                                                                    |
| --- | -------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| 01  | CLEAR    | Developer experience | Write the message where the UI happens; no ID bookkeeping; one runtime call                                            | Code showcase + live demos + readable `.po` catalogs                       |
| 02  | COMPLETE | Everything included  | Extraction, catalog updates, audits, ICU diagnostics, semantic merging, compilation, adapters, backend — one toolchain | 25 smoke-verified example apps, 6 framework families × 4 locale strategies |
| 03  | FAST     | Performance          | Cold extract over 1,500 files in **83.89 ms**; the warm re-run you trigger all day: **33.08 ms**                       | `benchmarks/e2e-workflow/results/latest.md`, drift-guarded                 |

Ordering rationale: the words escalate from subjective to measurable and land
on the most provable claim right before "PICK THREE." Tiles and page sections
follow the same order — developers see code first (the thing they scroll
for), and the benchmark chart becomes the peak of the three-piece run,
directly feeding the "how is that possible?" question the Mechanism section
answers.

### The myth is on-brand

Palamedes is not just a Greek-sounding name: in the myth he is credited with
inventing letters, numbers, counting, and board games. Letters = messages,
numbers = benchmarks, the game = the TriLock puzzle. This is storytelling,
not a factual claim — but it means the Greek theme is load-bearing, not
decoration, and it should survive every visual direction (interpreted
classically or abstractly).

### Visual note: puzzle without a jigsaw

Literal jigsaw pieces (curved knobs) would break the brand (radius 0, no
decoration). Render the metaphor Swiss: **three rectangular/L-shaped tiles
that tessellate into one square block**, separated by hairlines, with the
accent blue marking the shared joints. Static, reveal-on-scroll only,
`prefers-reduced-motion` degrades to instant. The same tessellation figure
returns in the Mechanism section as the architecture diagram.

---

## 3. Psychology map

Where each principle earns its place (and its ethical bound: every trigger is
backed by a real artifact — nothing manufactured):

| Principle                           | Placement                                                                                                                                                                           |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Framing / contrast                  | "Pick three" flips the familiar "pick two" resignation                                                                                                                              |
| Anchoring                           | Benchmark chart: competitor bars anchor, Palamedes bar lands                                                                                                                        |
| Loss aversion                       | Pain framing in section copy: broken `.po` merges after rebase, migrations that reopen i18n                                                                                         |
| Authority (social-proof substitute) | Maintainer track record (qooxdoo → Lingui-migration at Regrello → Salesforce acquisition), ADR series. No fake logo walls — when real adopters exist, a logo strip slot is reserved |
| Pratfall / honesty                  | "What Palamedes doesn't do" — deliberate scope, Palamedes+ optional, preview labels stay visible                                                                                    |
| Zero-price + endowment              | MIT, no account, catalogs live in _your_ repo — "you own it" is literal                                                                                                             |
| Activation energy / goal gradient   | QuickInstall in hero, "first translation in 5 minutes" as primary CTA everywhere                                                                                                    |
| Hick's law                          | One primary CTA per viewport; packages table leaves the homepage                                                                                                                    |
| Curse-of-knowledge check            | Hero lede must parse for someone who never used Lingui — test copy on an outsider                                                                                                   |

---

## 4. Proposed structure (JSX mock)

Pseudo-components; real copy drafts. Existing components in parentheses where
they can be reused.

```jsx
<Home>
  {/* ================================================== HERO — the claim */}
  <Hero>
    <Eyebrow>OPEN-SOURCE I18N FOR TYPESCRIPT</Eyebrow>
    {/*
     * The tri-construct. Three tiles tessellating into one square block —
     * hairline joints, accent-blue seams. Each tile is claim + receipt and
     * anchors to its section. This replaces TerminalCascade as hero visual.
     */}
    {/* Each tile carries its headline word as the mono micro-label, so the
        word ↔ piece mapping resolves without reading a single paragraph. */}
    <TriLock>
      <Tile
        n="01"
        label="CLEAR — DEVELOPER EXPERIENCE"
        code={`<Trans>Save changes</Trans>`}
        sub="no IDs, no dictionaries, one runtime call"
      />
      <Tile
        n="02"
        label="COMPLETE — EVERYTHING INCLUDED"
        stat={contentStats.smokeExampleCount}
        sub="verified example apps, 6 frameworks, 4 locale strategies"
      />
      <Tile
        n="03"
        label="FAST — PERFORMANCE"
        stat="29–79×"
        sub="faster than every tool doing the same job"
      />
    </TriLock>
    <H1>
      <Line>CLEAR. COMPLETE. FAST.</Line>
      <Line accent>PICK THREE.</Line>
    </H1>
    <Lede>
      i18n tooling usually makes you trade developer experience, scope, or speed against each other.
      Palamedes keeps one coherent model from source to runtime — a Rust core, first-party framework
      adapters, and catalogs your repository owns — so you don't have to.
    </Lede>
    <CtaRow>
      <Primary href="/get-started">First translation in 5 minutes</Primary>
      <Secondary href="/proof">See the receipts</Secondary>
    </CtaRow>
    <QuickInstall /> {/* keep: copy-paste beats promises */}
  </Hero>

  {/* ============================================= RECEIPTS — keep, retune */}
  {/* (ProofStrip) Same mechanics, sharper labels. The four strongest
      numbers — DX has no stat, so this strip stays numbers-first. */}
  <ReceiptsStrip
    stats={[
      {
        value: "29–79×",
        label: "faster than every tool doing the same job — same corpus",
        href: "/proof",
      },
      { value: "83.89 ms", label: "cold extract, realistic 1,500-file corpus", href: "/proof" },
      { value: `${smokeExampleCount}`, label: "smoke-verified example apps", href: "/frameworks" },
      { value: `${adrCount}`, label: "ADRs documenting every tradeoff", href: "/decisions" },
    ]}
  />

  {/* ============================== 01 — CLEAR: DEVELOPER EXPERIENCE */}
  <Section
    num="01 — Developer experience"
    title="Write the message where the UI happens."
    lede="No message-ID bookkeeping, no parallel dictionary files. Messages
          are identified by message + context — stable across refactors and
          years of catalog history. getI18n() resolves the active instance in
          server components, client islands, and backend handlers alike."
  >
    {/* (CodeShowcase) before/after: ID-based ceremony vs <Trans> in place */}
    <CodeShowcase />
    {/* (LocaleBookingCards) interactive: switch locale, watch copy, plural
        seat counts, currency and dates change together — the README matrix
        image, but live on the page */}
    <LocaleBookingCards />
    <FootLinks>
      <a href="/frameworks">Live demos per framework →</a>
      <a href={docs("catalog-formats")}>Catalogs translators can actually read →</a>
    </FootLinks>
  </Section>

  {/* ==================== 02 — COMPLETE: EVERYTHING INCLUDED */}
  <Section
    num="02 — Everything included"
    title="Stop assembling your i18n stack from parts."
    lede="Extraction, catalog updates, structured audits, ICU diagnostics,
          semantic Git merging, compilation, runtime — one native toolchain,
          not a plugin scavenger hunt. First-party adapters wire it into
          your framework so host quirks never leak into catalog semantics."
  >
    {/* The spec-sheet ledger — the "Mitgift". Swiss grid loves this:
        a bill of materials, dense, mono labels, hairline rows. */}
    <ShipsWithLedger
      rows={[
        ["EXTRACT + UPDATE", "one command, cached per file (ADR-019)"],
        ["CATALOG AUDITS", "machine-readable completeness & drift checks for CI"],
        ["ICU DIAGNOSTICS", "plural/select mistakes caught at extract time, not in prod"],
        ["SEMANTIC MERGE", "Git merge driver resolves .po conflicts by meaning"],
        ["COMPILATION", "catalogs compile to runtime artifacts — no runtime parsing"],
        [
          "FRAMEWORK ADAPTERS",
          "Next.js · TanStack Start · SolidStart · Waku · React Router · Remix v3 · Vite",
        ],
        ["BACKEND SERVERS", "request-local i18n for Hono & Express, same catalogs"],
        ["LOCALE STRATEGIES", "cookie · route · subdomain · TLD — pick per product, not per tool"],
        ["EDITOR & AI", "ESLint/Oxlint preview plugin · llms.txt for coding assistants"],
      ]}
    />

    {/* (FrameworkMatrix) breadth proof directly under the inventory */}
    <FrameworkMatrix />

    <OwnershipNote>
      All of it MIT. No account, no cloud dependency — catalogs live in your repository, and the
      toolchain stays useful on its own.
    </OwnershipNote>
  </Section>

  {/* ================================== 03 — FAST: PERFORMANCE (peak) */}
  <Section
    num="03 — Performance"
    title="Every extract finishes faster than a blink."
    lede="A full extract and catalog update over 1,500 files takes 83.89 ms —
          29× to 79× faster than every tool we measured doing the same job,
          cold, every cache cleared. (The one tool that skips catalog updates
          entirely is still 5.7× slower.) And that is the slow lane: touch
          five files and re-run — 33.08 ms, because unchanged files are
          neither read nor parsed. The compared tools re-extract everything,
          every time."
  >
    {/* (BenchmarkChart) cold bars anchor vs Lingui / React Intl /
        i18next-cli / General Translation; warm bar marked separately —
        capability, never a speedup claim (bench.ts rules hold). */}
    <BenchmarkChart corpus={BENCH_REALISTIC} warm={BENCH_REALISTIC_WARM} />
    <FootLink href="/proof">Why warm runs stay out of every speedup number →</FootLink>
  </Section>

  {/* ================================= 04 — MECHANISM: why no trade-off */}
  {/* (StatementBand) The skeptic's question answered: "every tool claims
      all three." The tessellation figure from the hero returns here as the
      architecture diagram — pieces lock because they're cut from one model. */}
  <StatementBand num="04 — Why this holds" figure="trilock-as-architecture">
    Speed, scope, and DX aren't three features we juggle — they fall out of one decision. One
    semantic model (message + context), one catalog engine (ferrocat, in Rust), one runtime contract
    (getI18n()), and adapters kept deliberately thin. Nothing is duplicated, so nothing drifts, and
    the native core does the careful work once. The full reasoning is public:
    {adrCount} ADRs, including the ones about what Palamedes refuses to do.
  </StatementBand>

  {/* ==================================== 05 — TRUST: maintainer + honesty */}
  <Section num="05 — Trust" title="Built from repeat experience, not a weekend take.">
    <MaintainerNote>
      Third generation of source-string-first i18n tooling from the same author — gettext-style
      macros in qooxdoo, a full enterprise Lingui migration at Regrello (acquired by Salesforce,
      2025), now Palamedes. Maintained by Sebastian Software GmbH.
    </MaintainerNote>
    {/* Pratfall, deliberately: scope honesty converts skeptics */}
    <HonestScope title="What Palamedes doesn't do">
      No TMS, no machine translation, no hosted dashboard. Palamedes covers the complete local
      workflow; Palamedes+ is a planned optional managed layer — the open-source core needs no
      account and stays complete without it.
    </HonestScope>
    <FootLinks>
      <a href="/decisions">The decision trail →</a>
      <a href="/blog">Why this exists →</a>
    </FootLinks>
  </Section>

  {/* ============================================ 06 — SWITCHING PATH */}
  {/* Status-quo bias: name the incumbent, lower the switching cost. */}
  <SwitchBand
    title="Coming from Lingui, react-intl, or i18next?"
    body="Source-string-first .po catalogs are often reusable after one
          extraction pass. The migration playbook and per-tool comparisons
          don't hide what stays hard."
    links={[
      { label: "Migration guide", href: docs("migrate-from-lingui") },
      { label: "Honest comparisons", href: "/compare" },
    ]}
  />

  {/* ================================================== FINAL CTA — keep */}
  <CtaBand
    headline="Your first working translation is 5 minutes away."
    primary={{ label: "Get started", href: "/get-started" }}
    secondary={{ label: "Star on GitHub", href: REPO }}
  />
</Home>
```

### What leaves the homepage

- **PackageCards / packages table** → get-started & docs. Reference material,
  not persuasion; it also duplicated the "Everything included" story badly.
- **TerminalCascade as hero visual** → candidate for the Performance section
  or /proof. The hero slot now belongs to the tri-construct.
- **Separate "Model" and "Workflow" sections** → absorbed: model → DX +
  Mechanism; workflow → Everything-included ledger. Page drops from 8 blocks
  to 7 with a clearer arc: claim → receipts → 3 pieces → mechanism → trust →
  switch → CTA.

---

## 5. Hero headline variants

**A (decided 2026-08-11): "CLEAR. COMPLETE. FAST. / PICK THREE."**
Three short words a non-native audience parses instantly. "Clear" carries
the DX claim and is literally the trilemma word from the README
("convenience, speed, and clarity"). Order escalates from subjective to
measurable and lands on the most provable word right before "PICK THREE."
Needs the tiles adjacent so "three" resolves instantly — which the layout
guarantees.

**A′ (alternative): "EFFECTIVE. COMPLETE. FAST."**
Same structure and ordering. "Effective" is safe and friendly, but generic —
it names an outcome every tool claims, and it doesn't say _what_ about the
experience is better. Fallback if "clear" feels too thin in the layout.

**B: "I18N MADE YOU CHOOSE. / PALAMEDES DOESN'T."**
More narrative, strong contrast frame, reads well aloud. Slightly less
concrete; the three pieces then do the naming.

**C (rejected): "ONE MODEL. / ZERO TRADE-OFFS."**
Closest to the current headline — but fails our own claims discipline: the
ADR series literally documents trade-offs, and the site must never claim
otherwise. Listed to show why it's rejected.

**D (rejected): "FAST. COMPLETE. CALM."**
The first draft. Dropped after review: "calm" only lands if you already know
the brand doctrine — a non-native first-time visitor reads it as vague. The
calm temperament stays where it belongs: in the voice, restraint, and
evidence density of the page (PRODUCT.md), not as a display word.

Sub-variants worth A/B-considering later: eyebrow "THE I18N TRILEMMA, RETIRED"
instead of the category line; secondary CTA "See the receipts" vs "See the
proof".

---

## 6. Claims register (what the new copy asserts, and its source)

### Number policy (audience-layered, decided 2026-08-11)

Milliseconds are abstract for most visitors, and competitor names mean
nothing to newcomers. Numbers therefore work in three layers:

1. **Layer 1 — hero & tri-band:** multipliers and physical comparisons only
   ("29–79×", "faster than a blink"). No milliseconds, no tool names.
2. **Layer 2 — receipts row & section ledes:** exact medians with corpus
   context (83.89 ms cold, 33.08 ms warm). Still no competitor names —
   except inside terminal output, which is program output, not copy.
3. **Layer 3 — charts, /proof, /compare:** tool names, full tables, linked
   reports. Lingui is first _named_ in chart labels and the switching
   section — the migration audience knows it; the awareness audience
   doesn't need it.

Every number/claim in the mock, with its receipt — extend
`verify-site-bench-data.mjs` coverage where prose quotes numbers:

| Claim                                                                    | Source                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 83.89 ms cold / 33.08 ms warm (5 touched files), realistic corpus        | `bench.ts` ← `benchmarks/e2e-workflow/results/latest.md` (guarded)                                                                                                                                                                                                                                                                                                                                                                                                                                |
| "29–79× faster than every tool doing the same job", realistic corpus     | guarded ratios of the same-scope lanes — floor Lingui 29.57×, ceiling i18next-cli 79.21×, GT 72.91× between; both ends rounded down. React Intl is excluded from the range **by the benchmark's own scope ruling**: `docs/benchmark-e2e-workflow.md` ("Reading The React Intl Row") states its lane "does less work than every other lane" and "must not be read as a catalog-update number". It stays in charts with its scope label; extend the verify script when the range is quoted in prose |
| "Even the tool that skips catalog updates entirely is still 5.7× slower" | React Intl 5.67× (guarded ratio), scope caveat from the same benchmark doc — pratfall-honest supporting line, never the headline range                                                                                                                                                                                                                                                                                                                                                            |
| "Every extract finishes faster than a blink"                             | 83.89 ms cold / 33.08 ms warm vs ~100 ms typical human blink; exact ms stays one layer down as the receipt                                                                                                                                                                                                                                                                                                                                                                                        |
| **Superseded:** "at least 10× faster than all others"                    | first rejected against the all-tools floor (React Intl 5.67×); after checking the benchmark scope ruling, the same-job floor is 29.57× — so the honest claim "29–79×" is _stronger_ than the requested 10×                                                                                                                                                                                                                                                                                        |
| 29.57× vs Lingui, cold, realistic corpus                                 | same report (guarded ratio) — layer 3 only (charts, /proof, /compare)                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Warm advantage excluded from speedup claims                              | README + bench.ts rules — keep verbatim                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 25 smoke-verified examples; 6 families × 4 strategies                    | `content-stats.json` (generated)                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ADR count                                                                | `content-stats.json`                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Per-file extraction cache, stat-validated                                | ADR-019                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Semantic merge driver, ICU diagnostics, audits                           | shipped ferrocat features, docs                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Maintainer history (qooxdoo, Regrello→Salesforce)                        | README "Who Builds This" links                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| "No account, MIT, repo-owned catalogs"                                   | LICENSE + product scope                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Remix v3 smoke-only, previews labeled                                    | keep the qualifier wherever Remix/preview packages appear                                                                                                                                                                                                                                                                                                                                                                                                                                         |

---

## 7. Visual exploration

### Round 1 — five opposed languages (closed 2026-08-11)

Outcome: the brand anchor holds — **Spec Ledger** (current tokens: warm paper,
navy ink, bronze accent, Cinzel display) stays. The pinwheel/tessellation
TriLock is **rejected**: squeezed to the hero's edge it read as restless,
Lego-like. The tri-construct must be set calmly — as a band, row, column,
table, or stack — never as an interlocking block graphic. The four
non-ledger concepts are archived below for reference; 04's
terminal-as-hero _content_ idea was carried into round 2.

### Round 3 — the synthesis (current direction)

Decision 2026-08-11: **Monument core × Editorial masthead**
(`hero-mock/r3-monument-masthead.html`). V1's centered, airy hero and calm
tri-band carry the page; V4's masthead (crest, Cinzel wordmark, double-rule
dateline with nav) replaces the plain topbar — it reads more Greek without
adding density. The separate eyebrow is dropped: the dateline's right slot
already carries "Open-source i18n for TypeScript", which is exactly the
de-densifying cut V4 needed. Element carry-overs into the page flow (per review 2026-08-11):

- **V3 terminal → section 03 · Performance** — the cold/warm `pmds extract`
  session in the ink panel, paired with the benchmark chart. Already sampled
  in the R3 mock as the first below-the-fold section.
- **V2 datasheet framing → section 02 · Everything included** — the
  ShipsWithLedger from the structure mock (section 4) is exactly V2's spec
  sheet; keep its framed head/foot treatment.
- **V4 column treatment** — optional for the mechanism/trust prose if those
  sections want editorial texture; not required.
- **Framework logo band** (requested 2026-08-12) — the framework support
  story gets a logo strip: Next.js · TanStack Start · SolidStart · Waku ·
  React Router · Remix v3 · Vite (+ Hono/Express for backend). It doubles as
  the trust band a young OSS project can't fill with customer logos yet —
  compatibility proof instead of adoption proof, and every logo links to its
  framework page with the live demo. Open point: check each project's
  logo/trademark usage guidelines before shipping (nominative "works with"
  use is common, but placement rules differ).

Numbers review (2026-08-11): the hero tile and section 03 headline moved
from milliseconds to layer-1 framing per the number policy in section 6 —
tile stat "29–79×", section headline "Every extract finishes faster than a
blink." Lingui's name left the hero area entirely. The claim went through
two verification passes: "at least 10× faster than all others" first failed
against the all-tools floor (React Intl 5.67×); the benchmark doc's own
scope ruling then established that React Intl's lane does less work and is
not a same-job comparison, making the honest same-job range **29–79×** —
stronger than the originally requested 10×. The partial-scope tool survives
as the supporting line "even the tool that skips catalog updates entirely
is still 5.7× slower."

Open refinements: badge-free production pass,
responsive behavior of the dateline (stacks on narrow viewports), and where
the site header chrome (ARDO) meets the masthead — the masthead is page
content on the homepage, so ARDO's header likely reduces to a slim utility
bar or hides on `/`.

### Round 2 — five brand-true stretches (closed)

Same tokens, same copy, five different layout languages. Each stretches the
brand in one named direction; mock files `hero-mock/r2-*.html`, PNGs in
`hero-mock/shots/`.

| #   | Variant       | Stretch                                                                                                          | Tri-construct treatment                           |
| --- | ------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| V1  | **Monument**  | Centered, monumental scale, museum whitespace                                                                    | One full-width band of three equal cells          |
| V2  | **Datasheet** | Evidence density as design — the hero _is_ a framed technical data sheet                                         | Rows in the spec table (01/02/03 as section rows) |
| V3  | **Terminal**  | Proof-first: a live `pmds extract` session in an ink terminal panel (uses the reserved term-ok/term-warn tokens) | Quiet three-cell strip below the hero             |
| V4  | **Editorial** | Broadsheet front page: masthead, dateline, italic standfirst, three text columns with roman numerals             | The three columns _are_ the pieces                |
| V5  | **Panels**    | Controlled color-block: full-height navy panel against paper                                                     | Vertical stacked ledger inside the panel          |

Reduction criteria unchanged (5-second clarity, proof-density
compatibility, ARDO/docs theming feasibility, distance from generic SaaS).
Note V2 and V3 are the most "Palamedes" (show the work); V1 and V4 are the
most distinctive typographically; V5 is the safest modern read. Elements
recombine freely — e.g. V3's terminal with V1's centered headline, or V2's
sheet as the _second_ viewport under any hero.

### Round 1 archive — five directions

Round 1 explored five colossally different languages to test how far the
Greek theme could stretch (mocks: `hero-mock/01…05-*.html`). It closed with
brand fidelity confirmed instead of a two-finalist shootout — kept here as
the record of what was considered and why the extremes lost.

| #   | Concept                | Language                                                                                                 | Greek interpretation                           | Temperature         |
| --- | ---------------------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | ------------------- |
| 01  | **Spec Ledger**        | Warm paper, navy ink, bronze accent, Cinzel Hellenic, hairlines — the current live trajectory, sharpened | Typographic (classical letterforms, restraint) | Calm-confident      |
| 02  | **Attic Poster**       | Terracotta clay, black, cream; meander borders; poster composition                                       | Literal-classical (black-figure pottery)       | Loud                |
| 03  | **Marble Inscription** | Marble white, engraved letterspaced caps (Optima), lapis accent, monumental whitespace                   | Literal-classical (stele / museum)             | Monumental-quiet    |
| 04  | **Phosphor Terminal**  | Near-black, phosphor green/amber, all-mono; the hero _is_ a terminal session; ΠΑΛΑΜΗΔΗΣ strip            | Abstracted (Greek letters as texture)          | Radical dev-native  |
| 05  | **Aegean Modern**      | Flat color-block: Aegean blue, sun yellow, white; bold grotesk, sentence case                            | Abstracted (palette + wave line)               | Contemporary-bright |

Reduction process (proposed):

1. **Round 1 (5 → 2):** gut reaction plus four hard criteria — 5-second
   clarity of "Pick three", proof-density compatibility (can it host
   benchmark charts, the matrix, spec tables without breaking), docs/ARDO
   theming feasibility (light token set; the site is currently light-only),
   and distance from generic SaaS.
2. **Round 2 (2 → 1):** build the full homepage structure (section 4) in
   both survivors as real layouts; test on an outsider for curse of
   knowledge; check WCAG contrast; then decide.
3. **Whichever direction wins:** PRODUCT.md's brand section must be updated —
   note that it has already drifted (it still documents electric blue
   `#0038ff` / `#fbfbf8` paper, while the live tokens are bronze `#8e6628`,
   navy ink `#0e2a4d`, warm paper `#faf9f4`, Cinzel display). A brand-voice
   decision of this size deserves an ADR per the decision-records
   convention.

Honest constraints per concept: 02 fights the "calm, evidence-first" product
temperament and is hard to sustain across docs; 03 is beautiful but risks
low information density (the ledger/spec tables would carry the proof); 04
contradicts the light-only site and reads hostile to non-developer visitors
(translators, stakeholders) — but its terminal-as-hero _content_ idea can be
lifted into any winner; 05 is the most conventional and the least ownable —
closest to generic modern SaaS despite the palette.

## 8. Competitor teardown → full-page structure (2026-08-12)

### What the field does (homepages fetched 2026-08-12)

| Site                   | Length                          | Above-fold artifact                                        | Proof strategy                                                      | Closing CTA                     |
| ---------------------- | ------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------- |
| lingui.dev             | ~6 sections                     | none — text-only hero                                      | logo wall late; **zero numbers anywhere**                           | "View Docs"                     |
| i18next.com            | no homepage — GitBook docs page | —                                                          | "1,500+ of top-100k websites" mid-page                              | none; ends on Locize/MCP promos |
| formatjs (react-intl)  | ~5 sections                     | live locale-switch demo                                    | stats row under hero: 50M+/mo, 14k stars, 150+ languages            | none — page just ends           |
| generaltranslation.com | ~14 sections                    | terminal ending in a result stat                           | hot logo wall directly after hero; compliance badges; 1 testimonial | "Deploy today" + Get a demo     |
| tolgee.io              | ~9                              | product demo                                               | testimonials linked to case studies                                 | soft "reach out"                |
| inlang.com             | ~15                             | code + enterprise logos                                    | logos + stats early                                                 | vague "Explore tools"           |
| vite.dev               | 6                               | install snippet + 6 logos                                  | logos, stars/downloads, testimonials                                | aspirational                    |
| biomejs.dev            | ~9                              | **benchmark in hero** ("~35× faster", "97% compatibility") | awards, logos, contributors                                         | dual path: install + editor     |

### Patterns adopted (source in parentheses)

1. Install snippet in the hero (Vite) — already in R3.
2. **Compatibility logo band directly under the hero** (GT/Vite position;
   framework logos per the 2026-08-12 request) — answers "works with my
   stack?" in two seconds.
3. Quantified receipts immediately after the claim (FormatJS stats row) —
   our receipts line.
4. Workflow-pipeline visual (Lingui's one excellent section — it visualizes
   the extract→compile pipeline; we do it with real commands).
5. Benchmark + migration-safety pairing (Biome's "35× faster" + "97%
   compatible" one-two → ours: "29–79×" + ".po catalogs often reusable
   after one extraction pass").
6. A real closing CTA with a dual practical path (Biome) — half the field
   (FormatJS, i18next) simply ends.
7. Every claim paired with an artifact (GT's discipline, our receipts
   culture).
8. FAQ/objection section (none of the i18n rivals has one; standard on
   modern long pages, feeds AEO/llms.txt culture).

### Patterns rejected

SaaS sign-up hero (Tolgee); sponsor-upsell clutter (i18next/Locize); README
depth on the marketing page (inlang, ~15 sections); proof pile-up without
narrative (Biome's back half); platform framing before simplicity is shown
(GT's 4-column "full stack" before any simple code).

**White space confirmed:** no competitor combines pipeline visual +
quantified stats + above-fold live artifact. Palamedes runs all three.

### Full-page structure v2 (12 sections)

Supersedes the 7-block arc in section 4; the copy blocks there remain the
copy source. Mock: `hero-mock/r4-full-page.html`.

| #   | Section                             | One message                              | Artifact                                | Existing component                                 |
| --- | ----------------------------------- | ---------------------------------------- | --------------------------------------- | -------------------------------------------------- |
| 1   | Masthead + Hero                     | Pick three.                              | headline + install snippet              | R3                                                 |
| 2   | Framework logo band                 | Works with your stack — verified         | 7+2 logos, each → live demo             | new (real SVG logos: asset task + trademark check) |
| 3   | Tri-band + receipts                 | The three pieces, each with a receipt    | stats                                   | R3                                                 |
| 4   | 01 · Clear — DX                     | Write where the UI happens               | before/after code + live locale demo    | CodeShowcase, LocaleBookingCards                   |
| 5   | 02 · Complete — Everything included | The whole workflow ships in the box      | ships-with ledger + 5-step pipeline     | new ledger (V2), WorkflowFlow                      |
| 6   | 03 · Fast — Performance             | Faster than a blink                      | terminal + benchmark bars               | TerminalCascade-style, BenchmarkChart              |
| 7   | Why this holds                      | One model, so no trade-off               | mechanism diagram                       | StatementBand                                      |
| 8   | The verified matrix                 | 6 families × 4 strategies, all real apps | matrix grid + legend (browser vs smoke) | FrameworkMatrix                                    |
| 9   | Trust                               | Third-generation tooling, honest scope   | maintainer + "what we don't do"         | Maintainer section                                 |
| 10  | Switching                           | Coming from X? Safe path over            | migration links + reuse claim           | rivals/compare pages                               |
| 11  | FAQ                                 | Objections, answered honestly            | 6 Q&A (account? production-ready? AI?)  | new                                                |
| 12  | Final CTA                           | First translation in 5 minutes           | dual path + myth line                   | CtaBand                                            |

### Benchmark visualization: unit grid (decided 2026-08-12)

Linear time bars fail at 29–79×: the winning bar becomes a 1.3% sliver. Log
scales flatten exactly the honestly-earned drama. Decision — **unit grid**
(Isotype principle: count, don't measure): one square = one complete
Palamedes extract-and-update run (83.89 ms); each rival row shows how many
complete runs finish while that tool runs once (floor-rounded squares, exact
multiple as the right-aligned label). React Intl keeps its "extract only —
narrower scope" label in the row. Warm runs stay out of the chart entirely
(capability, not a race). Variants: ratio-axis bars indexed to 1× as the
compact form for /proof and topic pages; a real-time race animation
(true-duration fills, reduced-motion → static grid) as a later enhancement.
`BenchmarkChart` gets reworked accordingly; sampled in `r4-full-page.html`.

## 9. Beyond the homepage — top-level surfaces (inventoried 2026-08-12)

Full route inventory and per-page structure notes were collected from the
live route files. Summary of what the revamp means for each surface:

| Surface                    | Keep                                                                          | Fix in revamp                                                                                                                                                                                                                                            |
| -------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| /frameworks                | The 6×4 matrix with per-cell hosting status — best asset on the site          | Three overlapping nav layers for the same 7 frameworks (matrix → panels → subpages); strategies section interrupts the flow; backend section is a one-button orphan. Fold panels into the matrix as the single entry point; adopt masthead form language |
| /proof                     | "Honest note" / "exact boundary" rails — a signature device, reuse site-wide  | Energy decays into bare link lists; the ADR trail (most persuasive asset for senior readers) is the weakest-rendered block. Give it a ledger treatment; swap chart to unit grid                                                                          |
| /get-started               | Tabbed stack picker, shortest page                                            | Everything sits in one numbered section; the scoped-package caveat lands before the first command; final CTA is a support link, not momentum. Split steps, move caveat after install, end forward                                                        |
| /blog                      | Simple scannable list, honest voice                                           | Index is manually duplicated against content files (drift waiting to happen — generate it at prebuild); no dates on the index; only hero without CTAs                                                                                                    |
| /compare + 7 rival pages   | The respect/flipside/honest spine; dated research; "not measured" rule        | Verdict sits two-thirds down (move a compact verdict up under the thesis); NATIVE_SHIFT block is byte-identical on all 8 pages; `/guides` says "Eight comparisons" while RIVALS.length is 7 (real drift — fix + derive from data)                        |
| 4 topic pages (+ /guides)  | problem→approach→evidence→FAQ shape is right for search; FAQ rendered visibly | The likeliest cold-entry pages are invisible in the nav (/guides is footer-only); pages are structurally interchangeable. Surface them, differentiate eyebrows                                                                                           |
| /docs + /decisions indexes | Prebuild pipeline, canonical sources                                          | Both indexes are unstyled generated bullet lists — the least-designed pages sit behind top-nav items. Styled, grouped index pages via the token bridge; /decisions index as the "decision trail" ledger                                                  |
| Nav                        | 5 items                                                                       | /get-started only exists as header CTA, /guides only in the footer — align nav with the new structure                                                                                                                                                    |

Sequencing: homepage first (this concept), then /proof and /compare (both
inherit decided elements: unit grid, number policy, masthead language), then
the index pages for /docs//decisions, then the smaller fixes.

### Detail concepts: /proof and /compare (mocked 2026-08-12)

Mocks: `homepage-revamp-mocks/r5-proof.html`, `r5-compare-hub.html`,
`r5-compare-rival.html` (Lingui as the example, copy taken from `rivals.ts`).

**Inner-page chrome — running head.** The broadsheet logic carried through:
only the homepage gets the full masthead; inner pages get a slim running
head (small crest · wordmark · accent section label · nav) over the double
rule. Sub-context extends the label ("Compare · Lingui").

**/proof — receipts as artifacts.** Hero keeps "Claims you can re-run." and
adds the copyable `pnpm bench:e2e` next to the primary CTA. Then: receipts
strip → 01 Benchmarks (three-corpora ledger with cold/warm/same-job-range
columns + environment header, unit grid, honest-note rail on the React Intl
scope) → 02 Verification (Build/Drive/Capture pipeline, the 6×4 matrix with
●/○ legend, versioned-capture strip) → 03 Catalog quality (ferrocat sheet)
→ 04 ICU boundary (exact-boundary rail) → 05 **the decision ledger**: the
ADR trail becomes a framed numbered table (no. · title · status) instead of
three bare links — fixing the page's weakest-rendered block. Close:
"Re-run the claims. Then start."

**/compare hub — cards become a ledger.** The rival grid becomes a spec
table: tool · position one-liner · measured column ("29.57× slower,
same-job lane" / "5.67× — extract only, narrower scope" / literal
"not measured — no claim implied") · researched date. The honesty rules
turn into visible table columns. "When Palamedes is wrong for you" stays as
four honest exits; NATIVE_SHIFT lives here once, explicitly ("this argument
lives here, once — not repeated on every comparison page").

**/engineering — the machine room (new page, mocked 2026-08-12,
`r6-engineering.html`).** For the technical audience that wants the black
magic named. Hero: _"«Written in Rust» is the boring half."_ — Rust buys
speed, not architecture; the page is about what Palamedes refuses to do at
runtime. Opens with the **machine map** (five layers: app → toolchain →
native core → artifacts → runtime, with the typed napi boundary as an ink
band between toolchain and core), then a **00 preamble answering the
wrapper question** ("so it's glue around oxc and ferrocat?" — borrowed
deliberately / ours-but-extracted / the decisions live in palamedes itself;
closing line: "A wrapper has no opinions. This one is made of them.") and
ten mechanisms, each with a real artifact and ADR chips:

1. Compiled, not interpreted — catalogs become executable message
   functions; no ICU parser ships to production (ADR-022/023). PO-vs-artifact
   code pair, labeled illustrative until real compiled output is dropped in.
2. The cache that trusts `stat` — flow diagram + cold/warm terminal
   (ADR-019/013/014).
3. Memory: arenas, not allocations — AST + strings in oxc's bump arena,
   thread-local arena reused with one `reset()` per file (verified in
   `crates/palamedes/src/extract.rs`), workflow-first boundary against copy
   costs. (mimalloc was tried during the ADR-013 investigation and
   deliberately not shipped, so it is not claimed.)
4. SIMD where it pays — **hand-written NEON in ferrocat-po's
   escapable-byte scanner** (16 bytes per iteration, five needles at once,
   `memchr3` fallback on other architectures — ferrocat is first-party, so
   the intrinsics are too, source comment quoted verbatim); `memchr2/3`
   structural scanning throughout the PO scanner and ICU parser ("literal
   segments skipped in bulk"); `smallvec` union layout + FxHash. The
   "pinned to the crate that carries it" rail keeps attribution exact:
   the palamedes crates themselves contain no hand-written SIMD.
5. Parallelism that had to be earned — the ADR-013 story rendered whole:
   naive per-core Rayon was 1.6× slower, samply @ 10 kHz found 92.8% of
   samples in `mach_vm_protect`, the shipped answer is a bounded pool of
   four (a measured constant, not a core count), with the real worker-count
   table (119/69/**45**/70/151/197 ms) and the honest "what didn't move the
   number" list.
6. ferrocat — one catalog engine; audit JSON + merge-driver command
   (ADR-006/015).
7. The typed boundary — workflow-first napi calls; TS types generated from
   the binding surface, "they cannot lie"; per-platform prebuilds
   (ADR-009/010/007).
8. Thin adapters by contract — adapters render module source from compiled
   artifacts, catalog semantics physically out of reach (ADR-011/008/002).
9. One runtime contract — AsyncLocalStorage request scope, RSC entry scope,
   locale fixed per document (ADR-005/025/020).
10. The machine that checks the marketing — `verify-site-bench-data.mjs`
    fails the site build when quoted numbers drift from the checked report;
    "the marketing is downstream of CI."

Open point: placement — own top-nav item vs. linked from /proof and the
homepage mechanism section. The ADR-chip device (mono chip linking each
claim to its decision record) is reusable site-wide.

**Rival template — verdict first, 8 → 6 sections.** The decide-picklists
move from position 06 to position 01 ("The verdict, first — ten seconds,
honestly") directly under the thesis rail; then credit & cost, differences,
code, the short table, the honest bit, sibling links. NATIVE_SHIFT is
removed from the template (hub-only). The closing CTA becomes
rival-specific ("Keep your authoring model. Swap the engine." for Lingui,
primary: migration guide).

## 10. Open questions & next steps

1. **Headline decision** — done: A, "CLEAR. COMPLETE. FAST. / PICK THREE."
   (A′ and B remain documented as the runners-up.)
2. **Visual direction** — round 2 running: five brand-true stretches
   (Monument / Datasheet / Terminal / Editorial / Panels). Pick survivors,
   recombine elements freely, then build the full section-4 structure in the
   winner. Reduced-motion and no-JS passes must hold
   (`verify-site-routes.mjs`).
3. **Copy test for curse of knowledge** — have someone who never used Lingui
   read only the hero; they should be able to say what Palamedes is and why
   it's different.
4. **PRODUCT.md narrative update** — the trilemma already exists in the
   README ("choose between convenience, speed, and clarity"); promoting it to
   the page spine should be reflected in PRODUCT.md's narrative section
   (small ADR-001-compatible edit, not a repositioning).
5. **Logo-strip slot** — decide the threshold for adding real adopter proof
   later; never placeholder logos.
6. **After sign-off** — implement behind the existing components where
   possible (BenchmarkChart, FrameworkMatrix, CodeShowcase, StatementBand,
   CtaBand all survive), then run the site verifiers.
