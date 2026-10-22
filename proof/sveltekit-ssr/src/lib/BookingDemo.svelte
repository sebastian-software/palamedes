<script lang="ts">
import { page } from "$app/state";
import { createDemoLocalePolicy } from "@palamedes/example-ui";
import { switchDemoLocale } from "@palamedes/example-ui";
import { onMount } from "svelte";
import { getI18n } from "@palamedes/runtime";
import { t } from "@palamedes/core/macro";
import { EVENT } from "@palamedes/example-ui";

import TicketPanel from "./TicketPanel.svelte";
import ProofPanel from "./ProofPanel.svelte";

let { proof }: { proof: { message: string } } = $props();
let ready = $state(false);
onMount(() => { ready = true; });

const copy = {
  locale: t`Locale`,
  eyebrow: t`Localized for this document with Palamedes`,
  title: t`Book your seat at Frontend Stage 2026`,
  greeting: t`Welcome back, ${EVENT.attendeeName}.`,
  description: t`Three days of talks on the craft of building for the web. Choose your tickets below.`,
  lazy: t`Show lazy catalog details`,
  insights: t`Open lazy page`,
  rendered: t`Rendered with SvelteKit`,
  runtime: t`server and client locale`,
};
const locale = getI18n().locale;
const languages = { en: "English", de: "Deutsch", fr: "Français", es: "Español" };
let open = $state(false);
let details = $state<Promise<typeof import("./LazyCatalogDetails.svelte")>>();

function toggleDetails() {
  open = !open;
  if (open) details ??= import("./LazyCatalogDetails.svelte");
}

function switchLocale(nextLocale: string) {
  switchDemoLocale(nextLocale);
}
</script>

<main class="page-shell">
  <header class="topbar">
    <div class="brand"><b>Frontend Stage</b><span class="brand-meta">Berlin · 2026</span></div>
    <div class="switcher">
      <span class="switcher-label">{copy.locale}</span>
      <div class="seg" role="group" aria-label="Language">
        {#each Object.entries(languages) as [code, label] (code)}
          <button
            data-testid={`locale-switch-${code}`}
            aria-label={label}
            aria-pressed={locale === code}
            disabled={locale === code}
            type="button"
            onclick={() => switchLocale(code)}
          >
            {code.toUpperCase()}
          </button>
        {/each}
      </div>
    </div>
  </header>
  <section class="hero">
    <p class="eyebrow"><span class="dot" aria-hidden="true"></span>{copy.eyebrow}</p>
    <h1>{copy.title}</h1>
    <p class="greet" data-testid="greeting">{copy.greeting}</p>
    <p class="lede">{copy.description}</p>
  </section>
  <div class="grid"><TicketPanel /><ProofPanel {proof} /></div>
  <section>
    <a data-testid="insights-link" href={createDemoLocalePolicy(new URL(page.url.href)).href(locale, "/insights")} data-sveltekit-preload-data="false">{copy.insights}</a>
    <button type="button" data-testid="lazy-catalog-trigger" onclick={toggleDetails}>
      {copy.lazy}
    </button>
    {#if open}
      {#await details}
        <p role="status">Loading details…</p>
      {:then loaded}
        {#if loaded}<loaded.default />{/if}
      {:catch}
        <p role="alert" data-testid="lazy-catalog-error">
          Details are temporarily unavailable. Reload the page to try again.
          <button type="button" onclick={() => window.location.reload()}>Reload page</button>
        </p>
      {/await}
    {/if}
  </section>
  <footer class="foot">
    <span class="foot-badge">Palamedes</span>{copy.rendered} · {copy.runtime}
    <strong data-testid="client-locale-value">{locale.toUpperCase()}</strong>
  </footer>
  {#if ready}<span data-testid="client-ready" hidden>ready</span>{/if}
</main>
