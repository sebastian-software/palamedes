/**
 * Route: /frameworks
 * Job: make the cross-framework claim tangible. Visitors arrive skeptical
 * ("works with MY stack?") and leave with a live demo open in a second tab.
 */

export function FrameworksPage() {
  return (
    <Page title="Palamedes — one i18n model across five framework families">
      <SiteNav />

      <Hero
        eyebrow="Framework matrix"
        headline="Five frameworks. Four locale strategies. One mental model."
        subline="Every cell below is a real, deployed application — the same
          booking UI, the same catalogs, the same runtime calls. Switch the
          language in any demo and watch copy, plurals, currency, and dates
          change together."
        primary={{
          label: "Open a live demo",
          href: "https://nextjs-cookie.examples.palamedes.dev",
        }}
        secondary={{
          label: "Browse the example source",
          href: "https://github.com/sebastian-software/palamedes/tree/main/examples",
        }}
      />

      {/* The interactive 5×4 grid is the centerpiece of this page. */}
      <Section id="matrix">
        <FrameworkMatrix
          frameworks={[
            { name: "Next.js", slug: "nextjs" },
            { name: "TanStack Start", slug: "tanstack" },
            { name: "SolidStart", slug: "solidstart" },
            { name: "Waku", slug: "waku" },
            { name: "React Router", slug: "react-router" },
          ]}
          strategies={[
            { name: "Cookie", slug: "cookie" },
            { name: "Route segment", slug: "route" },
            { name: "Subdomain", slug: "subdomain" },
            { name: "Top-level domain", slug: "tld" },
          ]}
          demoUrl={(f, s) => `https://${f}-${s}.examples.palamedes.dev`}
        />
        <p className="caption">
          All 20 apps are verified in CI with the same Playwright-driven browser flow: SSR output,
          locale switching, localized server actions. Screenshots are versioned in the repo.
        </p>
      </Section>

      {/* ------------------------------------------- locale strategy guide */}
      <Section id="strategies">
        <h2>Pick the locale strategy your product needs — not the one your framework dictates.</h2>
        <FeatureGrid
          columns={4}
          cards={[
            {
              icon: "cookie",
              title: "Cookie",
              body: "One URL for all locales. Best for apps behind login where SEO is irrelevant and switching should be instant.",
            },
            {
              icon: "route",
              title: "Route segment",
              body: "/de/checkout-style paths. The SEO-friendly default for public content with indexable localized pages.",
            },
            {
              icon: "globe",
              title: "Subdomain",
              body: "de.example.com. Clean separation per market, works well with regional CDNs and analytics splits.",
            },
            {
              icon: "flag",
              title: "Top-level domain",
              body: "example.de vs example.com. Maximum market trust; Palamedes maps each domain to its locale.",
            },
          ]}
        />
        <LinkList
          links={[
            {
              label: "Locale strategies in depth",
              href: "…/docs/locale-strategies.md",
            },
          ]}
        />
      </Section>

      {/* --------------------------------------------- per-framework panels */}
      <Section id="per-framework">
        <h2>Your stack, specifically.</h2>
        {/* Accordion or tab panel per framework; each panel: one paragraph on
            what is framework-specific (and how little that is), a code
            snippet of the integration point, links to live demos + source. */}
        <FrameworkPanel
          name="Next.js"
          body="App Router with server components and server actions. The
            @palamedes/next-plugin wires the transform into the Next build;
            everything else is the shared model."
          demoLinks={["cookie", "route", "subdomain", "tld"]}
          sourceHref="…/examples/nextjs-route"
        />
        <FrameworkPanel
          name="TanStack Start"
          body="Server functions and file-based routing, integrated through
            @palamedes/vite-plugin. Locale resolution runs in a server
            function; the client stays island-light."
          demoLinks={["cookie", "route", "subdomain", "tld"]}
          sourceHref="…/examples/tanstack-route"
        />
        <FrameworkPanel
          name="SolidStart"
          body="Fine-grained reactivity with @palamedes/solid — the same
            macro authoring and catalogs as React, no fork of your i18n
            strategy for a different renderer."
          demoLinks={["cookie", "route", "subdomain", "tld"]}
          sourceHref="…/examples/solidstart-route"
        />
        <FrameworkPanel
          name="Waku"
          body="Minimal RSC framework. If the model holds here, it holds in
            your custom setup too — that's why Waku is in the matrix."
          demoLinks={["cookie", "route", "subdomain", "tld"]}
          sourceHref="…/examples/waku-route"
        />
        <FrameworkPanel
          name="React Router"
          body="Framework-mode React Router with loaders and actions. The
            classic SPA-plus-SSR shape, same catalogs, same runtime."
          demoLinks={["cookie", "route", "subdomain", "tld"]}
          sourceHref="…/examples/react-router-route"
        />
      </Section>

      {/* --------------------------------------------------------- backend */}
      <Section id="backend">
        <h2>And it doesn't stop at the frontend.</h2>
        <p>
          The same getI18n() model runs in Hono and Express with request-local locale resolution —
          transactional emails, API error messages, and PDF generation speak the user's language
          from the same catalogs.
        </p>
        <Button variant="secondary" href="…/docs/backend-servers.md">
          Backend servers guide
        </Button>
      </Section>

      <CtaBand
        headline="See your framework speaking three languages — right now."
        primary={{
          label: "Open the live matrix",
          href: "https://nextjs-cookie.examples.palamedes.dev",
        }}
        secondary={{ label: "Get started", href: "/get-started" }}
      />

      <SiteFooter />
    </Page>
  )
}
