import { ButtonLink, Page, Section } from "@palamedes/site-ui";
import { PageHero } from "~/components/marketing/PageHero";
import { docsHref, repoHref } from "~/data/links";
import { pageMeta } from "~/lib/meta";

export const handle = { layout: "bare" };

export function meta() {
  return pageMeta({
    title: "SvelteKit SSR i18n | Palamedes",
    description:
      "SvelteKit connects native Svelte macros to translated server HTML, matching hydration, request-local endpoint messages, and active-language lazy catalogs.",
    path: "/frameworks/sveltekit",
  });
}

export default function SvelteKitFramework() {
  return (
    <Page>
      <PageHero
        kicker="SvelteKit 3 + Node"
        title="The same Svelte messages, from server to browser."
        lede="Keep macros in your Svelte components. The SvelteKit integration connects the shared Vite compiler to server rendering, request-local endpoint code, and the browser's catalogs before hydration."
        actions={
          <>
            <ButtonLink href={repoHref("proof/sveltekit-ssr", "tree")}>
              Run the SSR example
            </ButtonLink>
            <ButtonLink variant="outline" href="/frameworks/svelte">
              Read the Svelte authoring guide
            </ButtonLink>
          </>
        }
      />
      <Section
        num="01 — Working example"
        title="One booking app. Four languages. Both runtimes."
        lede="English, German, French, and Spanish render in the first HTML response, including without JavaScript. Browser checks verify matching hydration, ticket plurals and totals, cart actions, and localized endpoint refreshes in development and production."
      >
        <p className="max-w-[48em] text-[16px] leading-relaxed text-ink/80">
          Overlapping page and endpoint requests keep their language across awaits. Three initial
          component fragments load for the active language; a lazy component and another route each
          bring one more. Same-language routes stay in the document, while language controls start a
          new one. Catalog failures reach recovery UI before affected components execute.
        </p>
      </Section>
      <Section
        num="02 — Host wiring"
        title="One native compiler. A SvelteKit server hook."
        lede="The local Vite integration installs Palamedes before SvelteKit. The handle hook creates a runtime per request over a shared compiled server catalog, sets document locale metadata, and installs the active-language browser import map. Components contain no catalog loaders."
      >
        <p className="max-w-[48em] text-[16px] leading-relaxed text-ink/80">
          The Node adapter bundles the production runtime. A copied build runs without the checkout,
          PO files, workspace packages, or native compiler. The example uses absolute asset paths
          through <code>{"paths: { relative: false }"}</code>.
        </p>
      </Section>
      <Section
        num="03 — Deployment scope"
        title="A checked Node integration you can inspect."
        lede="The repository example uses SvelteKit 3.1.0, Svelte 5.57.2, Vite 8.2.2, and the Node adapter 6.0.0. It targets a root-mounted, same-origin deployment with query-selected locale and a fixed Europe/Berlin time zone."
      >
        <p className="max-w-[48em] text-[16px] leading-relaxed text-ink/80">
          The integration is local example code, with no published SvelteKit package. It is separate
          from the six-family URL-strategy matrix. Other adapters, CDN/subpath assets, prerendering,
          deferred streaming loads, remote functions, and catalog HMR remain unverified. The{" "}
          <a
            className="text-accent underline"
            href={docsHref("stability#sveltekit-ssr-preview-contract")}
          >
            integration reference
          </a>{" "}
          records the compatibility boundary.
        </p>
      </Section>
    </Page>
  );
}
