<script setup lang="ts">
import { defineAsyncComponent, h, ref } from "vue";
import { t } from "@palamedes/core/macro";
import { EVENT } from "@palamedes/example-ui";

import TicketPanel from "./TicketPanel.vue";
import ProofPanel from "./ProofPanel.vue";

const LazyCatalogDetails = defineAsyncComponent({
  loader: () => import("./LazyCatalogDetails.vue"),
  loadingComponent: { render: () => h("p", { role: "status" }, "Loading details…") },
  errorComponent: {
    render: () =>
      h("p", { role: "alert", "data-testid": "lazy-catalog-error" }, [
        "Details are temporarily unavailable. Reload the page to try again. ",
        h("button", { type: "button", onClick: () => window.location.reload() }, "Reload page"),
      ]),
  },
});
const copy = {
  locale: t`Locale`,
  eyebrow: t`Localized for this document with Palamedes`,
  title: t`Book your seat at Frontend Stage 2026`,
  greeting: t`Welcome back, ${EVENT.attendeeName}.`,
  description: t`Three days of talks on the craft of building for the web. Choose your tickets below.`,
  lazy: t`Show lazy catalog details`,
  rendered: t`Rendered with Vue`,
  runtime: t`client locale`,
};
const locale = document.documentElement.lang;
const languages = { en: "English", fr: "French", es: "Spanish" };
const open = ref(false);

function switchLocale(nextLocale: string) {
  const url = new URL(window.location.href);
  url.searchParams.set("locale", nextLocale);
  window.location.assign(url);
}
</script>

<template>
  <main class="page-shell">
    <header class="topbar">
      <div class="brand"><b>Frontend Stage</b><span class="brand-meta">Berlin · 2026</span></div>
      <div class="switcher">
        <span class="switcher-label">{{ copy.locale }}</span>
        <div class="seg" role="group" aria-label="Language">
          <button
            v-for="(label, code) in languages"
            :key="code"
            :data-testid="`locale-switch-${code}`"
            :aria-label="label"
            :aria-pressed="locale === code"
            :disabled="locale === code"
            type="button"
            @click="switchLocale(code)"
          >
            {{ code.toUpperCase() }}
          </button>
        </div>
      </div>
    </header>
    <section class="hero">
      <p class="eyebrow"><span class="dot" aria-hidden="true" />{{ copy.eyebrow }}</p>
      <h1>{{ copy.title }}</h1>
      <p class="greet" data-testid="greeting">{{ copy.greeting }}</p>
      <p class="lede">{{ copy.description }}</p>
    </section>
    <div class="grid"><TicketPanel /><ProofPanel /></div>
    <section>
      <button type="button" data-testid="lazy-catalog-trigger" @click="open = !open">
        {{ copy.lazy }}
      </button>
      <LazyCatalogDetails v-if="open" />
    </section>
    <footer class="foot">
      <span class="foot-badge">Palamedes</span>{{ copy.rendered }} · {{ copy.runtime }}
      <strong data-testid="client-locale-value">{{ locale.toUpperCase() }}</strong>
    </footer>
    <span data-testid="client-ready" hidden>ready</span>
  </main>
</template>
