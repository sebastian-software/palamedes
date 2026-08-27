import { Link } from "react-router"

import { ButtonLink, Page, Section } from "@palamedes/site-ui"
import { pageMeta } from "~/lib/meta"
import { FrameworkMatrix } from "~/components/frameworks/FrameworkMatrix"
import { FwPanels } from "~/components/frameworks/FwPanels"
import { CtaBand } from "~/components/home/CtaBand"
import { FeatureGrid } from "~/components/home/FeatureGrid"
import { STRATEGY_CARDS } from "~/data/features"
import contentStats from "~/data/generated/content-stats.json"
import { DEMO_NEXTJS_COOKIE, docsHref } from "~/data/links"

export const handle = { layout: "bare" }

export function meta() {
  return pageMeta({
    title: "Framework i18n guides for TypeScript | Palamedes",
    description:
      "Verified frontend and full-stack i18n adapters for Next.js, TanStack Start, Solid, Waku, React Router, Remix v3, and Vite, plus request-local backend integration guidance for Hono and Express.",
    path: "/frameworks",
  })
}

export default function Frameworks() {
  return (
    <Page>
      <section className="px-8 pt-16 pb-14 max-tight:px-5">
        <p className="eyebrow">Framework matrix</p>
        <h1 className="mt-6 max-w-[14em] text-display leading-[0.98] font-bold tracking-[-0.03em] text-balance">
          Six server frameworks. Vite. Two backend runtimes. One mental model.
        </h1>
        <p className="mt-6 max-w-[38em]">
          Frontend and full-stack hosts use first-party adapters and verified example applications.
          Hono and Express are a separate backend path: they use the shared runtime directly with
          request-local locale resolution. Start with the integration boundary you own, then inspect
          its exact setup and verification evidence.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <ButtonLink href="#frontend-frameworks">Frontend and full-stack adapters</ButtonLink>
          <ButtonLink variant="outline" href="#backend-integrations">
            Backend integrations
          </ButtonLink>
        </div>
      </section>

      <Section
        num="01 — Matrix"
        title={`The ${contentStats.serverFrameworkCount} × ${contentStats.localeStrategyCount} server matrix, plus Vite.`}
        id="frontend-frameworks"
      >
        <FrameworkMatrix scan />
        <p className="mt-4 max-w-[52em] text-[12.5px] text-gray-spec">
          All {contentStats.smokeExampleCount} apps are smoke-checked on relevant pull requests and
          main pushes. The {contentStats.browserExampleCount} browser-capable examples — the
          {contentStats.screenshotExampleCount} established UI-adapter matrix apps plus the Vite MDX
          proof — cover SSR output, locale switching, and localized server actions or functions in
          weekly or manual Playwright runs; the four Remix v3 apps cover server responses and locale
          handling through smoke checks. Versioned screenshots cover the{" "}
          {contentStats.screenshotExampleCount} UI-adapter examples; Vite has no capture artifact.
          Cookie, route, and subdomain demos are publicly hosted for four browser-verified
          frameworks. The TLD target URLs for all five browser-capable families are already linked
          as rollout probes while public routing and TLS are activated; Solid&apos;s renamed cookie,
          route, and subdomain hosts and every Remix v3 host are still provisioning. Hosting status
          is documented in the repo&apos;s demo-deployments guide.
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
        id="backend-integrations"
        title="Backend services are a separate integration path."
        lede="Hono and Express do not use a frontend adapter. They call the shared runtime with request-local locale resolution, so transactional emails, API errors, and PDF generation use the same catalogs without pretending to be framework UI."
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
