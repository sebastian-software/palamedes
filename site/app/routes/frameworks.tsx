import { Link } from "react-router"

import { ButtonLink } from "~/components/chrome/Button"
import { Page } from "~/components/chrome/Page"
import { pageMeta } from "~/lib/meta"
import { Section } from "~/components/chrome/Section"
import { FrameworkMatrix } from "~/components/frameworks/FrameworkMatrix"
import { FwPanels } from "~/components/frameworks/FwPanels"
import { CtaBand } from "~/components/home/CtaBand"
import { FeatureGrid } from "~/components/home/FeatureGrid"
import { STRATEGY_CARDS } from "~/data/features"
import contentStats from "~/data/generated/content-stats.json"
import { DEMO_NEXTJS_COOKIE, docsHref, repoHref } from "~/data/links"

export const handle = { layout: "bare" }

export function meta() {
  return pageMeta({
    title: "Framework i18n guides for TypeScript | Palamedes",
    description:
      "Framework-specific i18n guides and verified examples for Next.js, TanStack Start, SolidStart, Waku, React Router, Remix v3, and Vite.",
    path: "/frameworks",
  })
}

export default function Frameworks() {
  return (
    <Page>
      <section className="px-8 pt-16 pb-14 max-tight:px-5">
        <p className="eyebrow">Framework matrix</p>
        <h1 className="mt-6 max-w-[14em] text-display leading-[0.98] font-bold tracking-[-0.03em] text-balance">
          Six frameworks. Four locale strategies. One mental model.
        </h1>
        <p className="mt-6 max-w-[38em]">
          Every cell below is a real application verified in CI. The five established UI adapters
          run browser flows against the same booking UI, catalogs, and runtime calls; Remix v3 runs
          server smoke proofs against its new non-React stack. Where public hosting is ready, open
          the demo and switch the language. Then open the framework guide for its exact server
          boundary, TypeScript setup, and current limitations.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <ButtonLink href={DEMO_NEXTJS_COOKIE}>Open a live demo</ButtonLink>
          <ButtonLink variant="outline" href={repoHref("examples", "tree")}>
            Browse the example source
          </ButtonLink>
        </div>
      </section>

      <Section
        num="01 — Matrix"
        title={`The ${contentStats.frameworkCount} × ${contentStats.strategyCount} verified matrix.`}
      >
        <FrameworkMatrix scan />
        <p className="mt-4 max-w-[52em] text-[12.5px] text-gray-spec">
          All {contentStats.exampleCount} apps are verified in CI. The{" "}
          {contentStats.exampleCount - contentStats.strategyCount} established UI-adapter apps cover
          SSR output, locale switching, and localized server actions or functions in the browser;
          the {contentStats.strategyCount} Remix v3 apps cover server responses and locale handling
          through smoke checks. Screenshots cover the UI-adapter matrix and are versioned in the
          repo. Cookie, route, and subdomain demos are publicly hosted for the five browser-verified
          frameworks; the TLD domains are still being provisioned, and Remix v3 has no public
          hosting yet. Hosting status is documented in the repo&apos;s demo-deployments guide.
        </p>
      </Section>

      <Section
        num="02 — Strategies"
        title="Pick the locale strategy your product needs — not the one your framework dictates."
      >
        <FeatureGrid cards={STRATEGY_CARDS} columns={4} />
        <div className="mt-6 space-y-2">
          <Link
            to="/locale-routing"
            viewTransition
            className="mono-nums block text-[13px] text-accent"
          >
            Which strategy to pick, and what each one costs →
          </Link>
          <a
            href={docsHref("locale-strategies")}
            className="mono-nums block text-[13px] text-accent"
          >
            Locale strategies in depth →
          </a>
        </div>
      </Section>

      <Section num="03 — Per framework" title="Your stack, specifically.">
        <FwPanels />
      </Section>

      <Section
        num="04 — Backend"
        title="And it doesn't stop at the frontend."
        lede="The same getI18n() model runs in Hono and Express with request-local locale resolution — transactional emails, API error messages, and PDF generation speak the user's language from the same catalogs."
      >
        <ButtonLink variant="outline" href={docsHref("backend-servers")}>
          Backend servers guide
        </ButtonLink>
      </Section>

      <CtaBand
        headline="See your framework speaking three languages — right now."
        primary={{ label: "Open the live matrix", href: DEMO_NEXTJS_COOKIE }}
        secondary={{ label: "Get started", href: "/get-started" }}
      />
    </Page>
  )
}
