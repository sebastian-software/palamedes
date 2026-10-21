<script setup lang="ts">
import { defineAsyncComponent, h, ref, onMounted } from "vue";
import { useState as nuxtState, useRoute } from "#app";
import { useHead } from "#imports";
import { getI18n } from "@palamedes/runtime";
import { t } from "@palamedes/core/macro";
import { EVENT } from "@palamedes/example-ui";

import TicketPanel from "./TicketPanel.vue";
import ProofPanel from "./ProofPanel.vue";

const LazyCatalogDetails = defineAsyncComponent({
  loader: () => import("./CatalogDetails.vue"),
  loadingComponent: { render: () => h("p", { role: "status" }, "Loading details…") },
  errorComponent: {
    render: () =>
      h("p", { role: "alert", "data-testid": "lazy-catalog-error" }, [
        "Details are temporarily unavailable. Reload the page to try again. ",
        h("button", { type: "button", onClick: () => window.location.reload() }, "Reload page"),
      ]),
  },
});
const route = useRoute();
if (import.meta.server)
  await new Promise((resolve) =>
    setTimeout(resolve, Math.min(40, Math.max(0, Number(route.query.delay) || 0))),
  );
const copy = {
  locale: t`Locale`,
  eyebrow: t`Localized for this document with Palamedes`,
  title: t`Book your seat at Frontend Stage 2026`,
  greeting: t`Welcome back, ${EVENT.attendeeName}.`,
  description: t`Three days of talks on the craft of building for the web. Choose your tickets below.`,
  lazy: t`Show lazy catalog details`,
  rendered: t`Rendered with Nuxt`,
  runtime: t`server and client locale`,
  insights: t`Open lazy page`,
};
useHead({ title: copy.title });
const locale = nuxtState<string>("palamedes.locale").value;
const runtimeLocale = getI18n().locale;
const ready = ref(false);
onMounted(() => {
  ready.value = true;
});
const languages = { en: "English", de: "Deutsch", fr: "Français", es: "Español" };
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
      <NuxtLink
        :to="{ path: '/insights', query: { locale } }"
        no-prefetch
        data-testid="insights-link"
        >{{ copy.insights }}</NuxtLink
      >
    </section>
    <footer class="foot">
      <span class="foot-badge">Palamedes</span>{{ copy.rendered }} · {{ copy.runtime }}
      <strong data-testid="client-locale-value">{{ runtimeLocale.toUpperCase() }}</strong>
    </footer>
    <span v-if="ready" data-testid="client-ready" hidden>ready</span>
  </main>
</template>
