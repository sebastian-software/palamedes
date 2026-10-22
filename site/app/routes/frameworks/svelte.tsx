import { ButtonLink, Page, Section } from "@palamedes/site-ui";
import { PageHero } from "~/components/marketing/PageHero";
import { docsHref, repoHref } from "~/data/links";
import { pageMeta } from "~/lib/meta";

export const handle = { layout: "bare" };

export function meta() {
  return pageMeta({
    title: "Svelte i18n with native macros | Palamedes",
    description:
      "Write translation macros directly in Svelte component scripts. Native extraction, source maps, and active-language catalogs connect to Svelte 5 and Vite.",
    path: "/frameworks/svelte",
  });
}

const component = `<script lang="ts">
import { plural, t } from "@palamedes/core/macro";

const title = t\`Choose your tickets\`;
let quantity = $state(1);
const label = $derived(plural(quantity, {
  one: "# ticket", other: "# tickets",
}));
</script>

<h1>{title}</h1>
<button onclick={() => quantity++}>{label}</button>`;

export default function SvelteFramework() {
  return (
    <Page>
      <PageHero
        kicker="Svelte 5 + Vite"
        title="Svelte i18n, directly in your components."
        lede="Write messages beside your component logic. Palamedes extracts and transforms macros in Svelte scripts before the Svelte compiler runs, then delivers the active language before the component executes."
        actions={
          <>
            <ButtonLink href={docsHref("api/vite-plugin#svelte-components-preview")}>
              Configure the Vite plugin
            </ButtonLink>
            <ButtonLink variant="outline" href={repoHref("proof/svelte-vite", "tree")}>
              Run the booking example
            </ButtonLink>
          </>
        }
      />
      <Section num="01 — Authoring" title="Messages stay in your .svelte files.">
        <pre
          className="pmds-code overflow-x-auto border border-hair px-5 py-4 text-[13px] leading-relaxed"
          tabIndex={0}
        >
          <code>{component}</code>
        </pre>
        <p className="mt-5 max-w-[48em] text-[16px] leading-relaxed text-ink/80">
          Put <code>{'palamedes({ framework: "none", mdx: false })'}</code> before the official
          Svelte plugin. Inline JavaScript and TypeScript instance and module scripts support core
          macros. Import macros in the script block that uses them; module-level calls belong inside
          functions. The native CLI preserves source locations, and the transform retains source
          maps.
        </p>
      </Section>
      <Section
        num="02 — Working example"
        title="The same booking app, in four languages."
        lede="The Frontend Stage example shares its data and styles with the other integrations. Development and production browser checks cover English, German, French, and Spanish: reactive plurals, currency totals, cart actions, lazy component catalogs, locale navigation, and delivery failures."
      >
        <p className="max-w-[48em] text-[16px] leading-relaxed text-ink/80">
          The Vite example runs in the browser. For server rendering and hydration, use the separate{" "}
          <a className="text-accent underline" href="/frameworks/sveltekit">
            SvelteKit integration
          </a>
          . Author macros in scripts and render their values in markup. Template-expression macros,
          Svelte rich text, and catalog HMR are outside the current component contract; the{" "}
          <a
            className="text-accent underline"
            href={docsHref("stability#svelte-component-preview-contract")}
          >
            integration reference
          </a>{" "}
          records the exact scope.
        </p>
      </Section>
    </Page>
  );
}
