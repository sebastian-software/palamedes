<script setup lang="ts">
import { useDemoHref } from "../composables/useDemoHref";
const demoHref = useDemoHref();
import { t } from "@palamedes/core/macro";
const title = t`Lazy catalog detail loaded.`;
const back = t`Back to booking`;
</script>

<template>
  <main class="page-shell">
    <h1 data-testid="insights-title">{{ title }}</h1>
    <NuxtLink :to="demoHref('/')" no-prefetch data-testid="booking-link">{{ back }}</NuxtLink>
  </main>
</template>
