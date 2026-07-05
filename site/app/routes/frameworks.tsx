import { ButtonLink } from "~/components/chrome/Button"
import { Page } from "~/components/chrome/Page"
import { pageMeta } from "~/lib/meta"
import { Section } from "~/components/chrome/Section"
import { FrameworkMatrix } from "~/components/frameworks/FrameworkMatrix"
import { FwPanels } from "~/components/frameworks/FwPanels"
import { CtaBand } from "~/components/home/CtaBand"
import { FeatureGrid } from "~/components/home/FeatureGrid"
import { STRATEGY_CARDS } from "~/data/features"
import { DEMO_NEXTJS_COOKIE, repoHref } from "~/data/links"

export function meta() {
  return pageMeta({
    title: "Palamedes — one i18n model across five framework families",
    description:
      "Five frameworks, four locale strategies, one mental model: the browser-verified Palamedes example matrix across Next.js, TanStack Start, SolidStart, Waku, and React Router.",
    path: "/frameworks",
  })
}

export default function Frameworks() {
  return (
    <Page>
      <section className="px-8 pt-16 pb-14 max-tight:px-5">
        <p className="eyebrow">Framework matrix</p>
        <h1 className="mt-6 max-w-[14em] text-display leading-[0.98] font-bold tracking-[-0.03em] text-balance">
          Five frameworks. Four locale strategies. One mental model.
        </h1>
        <p className="mt-6 max-w-[38em]">
          Every cell below is a real application — the same booking UI, the same catalogs, the same
          runtime calls — browser-verified in CI. Where public hosting is ready, open the demo,
          switch the language, and watch copy, plurals, currency, and dates change together.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <ButtonLink href={DEMO_NEXTJS_COOKIE}>Open a live demo</ButtonLink>
          <ButtonLink variant="outline" href={repoHref("examples", "tree")}>
            Browse the example source
          </ButtonLink>
        </div>
      </section>

      <Section num="01 — Matrix" title="The 5 × 4 verified matrix.">
        <FrameworkMatrix scan />
        <p className="mt-4 max-w-[52em] text-[12.5px] text-gray-spec">
          All 20 apps are verified in CI with the same Playwright-driven browser flow: SSR output,
          locale switching, localized server actions. Screenshots are versioned in the repo. Cookie
          and route demos are publicly hosted today; subdomain and TLD hosting is being provisioned
          — until then those cells link the verified source instead.
        </p>
      </Section>

      <Section
        num="02 — Strategies"
        title="Pick the locale strategy your product needs — not the one your framework dictates."
      >
        <FeatureGrid cards={STRATEGY_CARDS} columns={4} sectionIndex="02" />
        <a
          href={repoHref("docs/locale-strategies.md")}
          className="mono-nums mt-6 inline-block text-[13px] text-accent"
        >
          Locale strategies in depth →
        </a>
      </Section>

      <Section num="03 — Per framework" title="Your stack, specifically.">
        <FwPanels />
      </Section>

      <Section
        num="04 — Backend"
        title="And it doesn't stop at the frontend."
        lede="The same getI18n() model runs in Hono and Express with request-local locale resolution — transactional emails, API error messages, and PDF generation speak the user's language from the same catalogs."
      >
        <ButtonLink variant="outline" href={repoHref("docs/backend-servers.md")}>
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
