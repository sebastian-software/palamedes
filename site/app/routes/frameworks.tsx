import { Link } from "react-router";

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
      "i18n integrations for React, Vue, Svelte, Solid, and Remix, including Next.js, Nuxt, and SvelteKit. Shared catalogs also connect Hono, Express, and Rust applications.",
    path: "/frameworks",
  });
}

export default function Frameworks() {
  return (
    <Page>
      <PageHero
        kicker="Frameworks"
        title="Built for the framework you already use."
        lede="React, Vue, Svelte, Solid, and Remix share the same message model. Connect Next.js, Nuxt, SvelteKit, TanStack Start, Waku, React Router, or Vite. Six server framework families cover four URL strategies; separate Vue, Nuxt, Svelte, and SvelteKit examples show their component and rendering integrations."
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
        title="Every server framework, every URL strategy — running as an app."
        lede={`${contentStats.serverFrameworkCount} frameworks × ${contentStats.localeStrategyCount} locale strategies. Open a live demo, or read the source of the exact app behind each cell.`}
        id="frontend-frameworks"
      >
        <FrameworkMatrix scan />
        <p className="mt-4 max-w-[52em] text-[12.5px] text-gray-spec">
          All {contentStats.smokeExampleCount} apps are smoke-checked on relevant pull requests and
          main pushes. All {contentStats.browserExampleCount} apps have Playwright browser
          contracts, including the four full-stack Remix strategies and the Vite MDX example. The
          server examples cover SSR, locale switching, and localized server actions or functions;
          Remix also verifies Frames and catalog recovery. Versioned screenshots cover the{" "}
          {contentStats.screenshotExampleCount} established UI-adapter examples; Remix and Vite have
          no capture artifacts. All six framework families have live cookie, route, subdomain, and
          TLD demos. The separate Vite MDX demo is also live. Hosting evidence is documented in the
          repo&apos;s demo-deployments guide.
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
