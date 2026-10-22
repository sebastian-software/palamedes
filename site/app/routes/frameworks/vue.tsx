import { ButtonLink, Page, Section } from "@palamedes/site-ui";
import { PageHero } from "~/components/marketing/PageHero";
import { V2ReleaseNotice } from "~/components/V2ReleaseNotice";
import { docsHref, repoHref } from "~/data/links";
import { pageMeta } from "~/lib/meta";

export const handle = { layout: "bare" };

export function meta() {
  return pageMeta({
    title: "Vue 3 + Vite i18n preview | Palamedes",
    description:
      "Write Palamedes macros directly in Vue SFC scripts. The experimental Vue 3 + Vite integration verifies native extraction, transforms, and lazy active-locale catalogs.",
    path: "/frameworks/vue",
  });
}

const component = `<script setup lang="ts">
import { ref } from "vue";
import { plural, t } from "@palamedes/core/macro";

const title = t\`Choose your tickets\`;
const quantity = ref(1);

function ticketLabel(count: number) {
  return plural(count, { one: "# ticket", other: "# tickets" });
}
</script>

<template>
  <h1>{{ title }}</h1>
  <p>{{ ticketLabel(quantity) }}</p>
  <button @click="quantity++">+</button>
</template>`;

export default function VueFramework() {
  return (
    <Page>
      <PageHero
        kicker="Vue 3 + Vite · Preview"
        title="Vue i18n, directly in your components."
        lede="Author messages in script setup or normal script blocks. The native compiler extracts and transforms them before Vue compiles the component; Vite delivers the active language before translated code runs."
        actions={
          <>
            <ButtonLink href={docsHref("api/vite-plugin#vue-single-file-components")}>
              Configure the Vite plugin
            </ButtonLink>
            <ButtonLink variant="outline" href={repoHref("proof/vue-vite", "tree")}>
              Run the booking proof
            </ButtonLink>
          </>
        }
      >
        <V2ReleaseNotice className="mt-7 max-w-[40rem]" />
      </PageHero>
      <Section num="01 — Authoring" title="Messages stay in your .vue files.">
        <pre
          className="pmds-code overflow-x-auto border border-hair px-5 py-4 text-[13px] leading-relaxed"
          tabIndex={0}
        >
          <code>{component}</code>
        </pre>
        <p className="mt-5 max-w-[48em] text-[16px] leading-relaxed text-ink/80">
          Place <code>{'palamedes({ framework: "none", mdx: false })'}</code> before the official
          Vue plugin. Import macros in the script block that uses them. Render their results in the
          template; calls directly in template expressions and Vue rich-text components are not
          supported.
        </p>
      </Section>
      <Section
        num="02 — Verified proof"
        title="The same booking app, in four languages."
        lede="The local proof shares the Frontend Stage 2026 data and styles with the framework examples. Development and production browser checks cover English, German, French, and Spanish: reactive ticket plurals, currency totals, cart actions, lazy catalog reuse, document navigation, and delivery failures."
      >
        <p className="max-w-[48em] text-[16px] leading-relaxed text-ink/80">
          Native CLI extraction reports the original SFC locations and detects catalog drift. Source
          maps preserve the component source. This proof is separate from the six server framework
          families and their four-strategy matrix; it has no hosted demo or SSR proof.
        </p>
      </Section>
      <Section
        num="03 — Nuxt boundary"
        id="nuxt"
        title="Nuxt has a separate SSR proof."
        lede="The Nuxt 4 proof reuses the same SFC compiler and adds request-local server initialization, Nitro catalog delivery, and matching browser initialization before hydration. It targets a root-mounted Node deployment."
      >
        <p className="max-w-[48em] text-[16px] leading-relaxed text-ink/80">
          Its development and production checks cover translated HTML without JavaScript, concurrent
          requests, hydration, lazy pages, server endpoints, and document locale navigation. It
          remains a private Preview proof outside the supported example matrix.
          <a className="text-accent underline" href="/frameworks/nuxt">
            {" "}
            Explore the Nuxt proof.
          </a>
        </p>
      </Section>
    </Page>
  );
}
