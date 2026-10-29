import { ArdoLink as Link } from "ardo/runtime";

import { ButtonLink, Page, Section } from "@palamedes/site-ui";
import { PageHero } from "~/components/marketing/PageHero";
import { pageMeta } from "~/lib/meta";
import { FrameworkMatrix } from "~/components/frameworks/FrameworkMatrix";
import { FwPanels } from "~/components/frameworks/FwPanels";
import { CtaBand } from "~/components/home/CtaBand";
import { FeatureGrid } from "~/components/home/FeatureGrid";
import { STRATEGY_CARDS } from "~/data/features";
import contentStats from "~/data/generated/content-stats.json";
import { DEMO_NEXTJS_COOKIE, docsHref } from "~/data/links";

export const handle = { layout: "bare" };

export function meta() {
  return pageMeta({
    title: "Framework i18n guides for TypeScript | Palamedes",
    description:
      "Stable i18n adapters for Next.js, TanStack Start, React Router, Remix, Waku, and Solid, plus Preview proofs for Vue, Nuxt, Svelte, and SvelteKit. Shared catalogs also connect Hono, Express, and Rust applications.",
    path: "/frameworks",
  });
}

export default function Frameworks() {
  return (
    <Page>
      <PageHero
        kicker="Frameworks"
        title="Built for the framework you already use."
        lede="Stable adapters connect Next.js, TanStack Start, React Router, Remix, Waku, Solid, and Vite with the same message model. Vue, Nuxt, Svelte, and SvelteKit are Preview proofs with no published package yet. All ten framework families run the four matrix strategies: cookie, route prefix, subdomain, and TLD, with the same booking demo in four languages."
        actions={
          <>
            <ButtonLink href="#frontend-frameworks">See the verified matrix</ButtonLink>
            <ButtonLink variant="outline" href="#backend-integrations">
              Backend integrations
            </ButtonLink>
          </>
        }
      />

      <Section
        num="01 — Matrix"
        title="Four URL strategies per framework — running as apps."
        lede={`${contentStats.demoFrameworkCount} frameworks × ${contentStats.localeStrategyCount} locale strategies. Open a live demo, or read the source of the exact app behind each cell.`}
        id="frontend-frameworks"
      >
        <FrameworkMatrix scan />
        <p className="mt-4 max-w-[52em] text-[12.5px] text-gray-spec">
          All {contentStats.demoCount} demos are smoke-checked in the production image and have
          Playwright browser contracts. Vue and Svelte render in the browser; Nuxt, SvelteKit, and
          the six other app frameworks also check server rendering and hydration. Versioned
          screenshots cover {contentStats.screenshotExampleCount} established UI-adapter examples.
          The separate{" "}
          <a
            href="https://vite-mdx.examples.palamedes.dev"
            className="text-accent underline underline-offset-2"
          >
            Vite MDX demo
          </a>{" "}
          is also live. See the{" "}
          <a
            href={docsHref("demo-deployments")}
            className="text-accent underline underline-offset-2"
          >
            hosting evidence
          </a>{" "}
          for public verification.
        </p>
      </Section>

      <Section
        num="02 — Strategies"
        title="Pick the locale strategy your product needs — not the one your framework dictates."
      >
        <FeatureGrid cards={STRATEGY_CARDS} columns={4} />
        <p className="mt-6 max-w-[52em] text-[15.5px] leading-relaxed text-ink/80">
          Explicit language domains are a fifth option in the shared locale controls. Map
          my-product.com to English and mein-produkt.de to German, with no locale path prefix. TLD
          mode changes only the final DNS label; domain mode maps the complete hostname. This
          additional option and SEO link generation have focused core tests; the live matrix above
          covers cookie, route prefix, subdomain, and TLD.
        </p>
        <div className="mt-6 space-y-2">
          <Link to="/locale-routing" className="mono-nums block text-[13px] text-accent">
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

      <Section
        num="05 — Rust"
        id="rust-applications"
        title="Your Rust app can load translations separately."
        lede="Cargo prepares external language catalogs for native CLIs and services. Translate text, display arguments, string selects, and cardinal and ordinal plurals. The guide includes the Cargo dependency, supported message forms, and a complete example you can run."
      >
        <ButtonLink variant="outline" href={docsHref("rust-applications")}>
          Rust applications guide
        </ButtonLink>
      </Section>

      <CtaBand
        headline="See your framework speaking four languages — right now."
        lede="The live demos are the same applications CI checks. Switch the language and watch server and client stay in step."
        primary={{ label: "Open a live demo", href: DEMO_NEXTJS_COOKIE }}
        secondary={{ label: "Get started", href: "/get-started" }}
      />
    </Page>
  );
}
