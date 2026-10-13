# Adoption skill fixtures

These small consumer projects exercise `skills/palamedes`. They deliberately
start without Palamedes wiring. The compatible target is the repository's built
workspace preview, not registry `latest`.

- `nextjs/`: Next.js 16 App Router with an existing config option and root layout
- `vite-react/`: browser React with existing Vite options, document, and mount
- `lingui/src`: mixed macro imports, a deferred descriptor and its runtime
  caller, four explicit IDs, named interpolation/plural, and two contexts for
  `Open`; English/German PO files include translator notes, a flag, and headers
- `lingui/ambiguous.json`: two context-free IDs with conflicting German
  translations; the migration requires a semantic decision before mutation
- `lingui/mapping.json`: assertion oracle for the resolved six identities
- `lingui/migrated/src`: reviewed output from an independent skill application,
  retaining the six original translations; generated references are omitted

`pnpm test:adoption-skill` materializes the actual file snippets from the bundled
host references, combines migration output when selected, and uses the native
CLI/extractor/compiler and compiled runtime. It checks both locales, all mapped
translations and metadata, context separation, repeated extraction stability,
named interpolation/plural output, and missing-entry failure. This runs in the
root test gate. It does not simulate an AI agent's reasoning.

`pnpm verify:adoption-skill` creates four temporary apps, builds and starts the
actual hosts, and checks their production output in Chromium for both locales.
Next output is also checked before hydration and for absent `Set-Cookie`.
Vite's document language is supplied before entry evaluation. Servers use owned
ephemeral ports; outputs live under ignored `coverage/adoption-skill` and are
removed after checks. Build workspace packages first. Host dependencies come
from the installed example dependency trees, so these checks exercise a preview
integration rather than package installation or lockfile resolution.

For an independent forward test, give a fresh agent the skill, one raw host
fixture, the Lingui config/source/catalogs, and the ambiguous case. Do not give
it `mapping.json`, `migrated/`, another agent's output, or a suggested solution.
Ask it to set up that host and migrate Lingui while preserving configuration
and translations, using the explicitly supplied preview target. Keep its
outputs isolated and verify rendered output and catalog preservation afterward.

The initial independent Next.js and Vite runs exercised setup and migration in
both locales and retained the ambiguous input. These fixtures do not establish
coverage for rich-text tag remapping, numeric legacy placeholders, dynamic ID
consumers, TMS contracts, existing instrumentation composition, or installation
against a released package. Add representative fixtures before claiming those
cases are verified.
