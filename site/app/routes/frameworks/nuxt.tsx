import { ButtonLink, Page, Section } from "@palamedes/site-ui";
import { PageHero } from "~/components/marketing/PageHero";
import { V2ReleaseNotice } from "~/components/V2ReleaseNotice";
import { docsHref, repoHref } from "~/data/links";
import { pageMeta } from "~/lib/meta";

export const handle = { layout: "bare" };

export function meta() {
  return pageMeta({
    title: "Nuxt 4 SSR i18n preview | Palamedes",
    description:
      "A private Nuxt 4 + Nitro proof verifies Vue SFC macros, translated server HTML, hydration, active-locale lazy catalogs, and request-local API messages in four languages.",
    path: "/frameworks/nuxt",
  });
}

export default function NuxtFramework() {
  return (
    <Page>
      <PageHero
        kicker="Nuxt 4 + Nitro · Preview"
        title="The same Vue messages, from server to browser."
        lede="Write core macros in Vue SFC scripts. The local Nuxt module connects the existing compiler to request-local server rendering, Nitro API handlers, and locale-bound catalogs before hydration."
        actions={
          <>
            <ButtonLink href={repoHref("proof/nuxt-ssr", "tree")}>Run the SSR proof</ButtonLink>
            <ButtonLink variant="outline" href="/frameworks/vue">
              Read the Vue authoring contract
            </ButtonLink>
          </>
        }
      >
        <V2ReleaseNotice className="mt-7 max-w-[40rem]" />
      </PageHero>
      <Section
        num="01 — Verified proof"
        title="One booking app. Four languages. Both runtimes."
        lede="The Frontend Stage 2026 demo shares its event data and styling with the other examples. Development and production checks cover English, German, French, and Spanish: translated HTML without JavaScript, matching hydration, ticket plurals and totals, cart actions, and localized server queries."
      >
        <p className="max-w-[48em] text-[16px] leading-relaxed text-ink/80">
          Overlapping page renders and API requests keep their language across awaits. Initial
          components load three active-language fragments; an async component and a lazy Nuxt page
          each bring one more. Same-language page navigation reuses the document, while language
          controls start a new one. Failed catalog delivery reaches recovery UI before affected
          content can run.
        </p>
      </Section>
      <Section
        num="02 — Host wiring"
        title="The compiler stays shared. Nuxt owns the lifecycle."
        lede="The local module installs the Vite compiler before Vue processing and uses the same server-targeted compiler for Nitro handlers. Each request gets its own runtime; Nitro shares one lazily loaded production catalog store across page and API code."
      >
        <p className="max-w-[48em] text-[16px] leading-relaxed text-ink/80">
          The server serializes the locale into Nuxt state and HTML attributes. The client
          initializes after payload revival, with the same time zone. Generated locale bindings are
          embedded during the build, so the deployed output does not need source catalogs or the
          native compiler. Components contain no catalog loaders or manifest plumbing.
        </p>
      </Section>
      <Section
        num="03 — Preview boundary"
        title="A Node SSR spike, with a clear deployment scope."
        lede="There is no published Nuxt package. This private proof targets Nuxt 4.6.2, Vue 3.5.44, Vite 8.3.4, and Nitro 2.13.5 in a root-mounted, same-origin Node deployment with query-selected locale. It is separate from the six-family, four-strategy example matrix."
      >
        <p className="max-w-[48em] text-[16px] leading-relaxed text-ink/80">
          Other Nitro presets, CDN or subpath assets, prerendering, streaming, islands, other locale
          URL strategies, and catalog HMR are not verified. Template macros and Vue rich text remain
          unsupported. The{" "}
          <a
            className="text-accent underline"
            href={docsHref("stability#nuxt-ssr-preview-contract")}
          >
            stability guide
          </a>{" "}
          records the compatibility boundary.
        </p>
      </Section>
    </Page>
  );
}
