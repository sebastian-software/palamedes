<script setup lang="ts">
import { t } from "@palamedes/core/macro";
import { useState as nuxtState } from "#app";
const locale = nuxtState<string>("palamedes.locale").value;
const title = t`Lazy catalog detail loaded.`;
const back = t`Back to booking`;
</script>

<template>
  <main class="page-shell">
    <h1 data-testid="insights-title">{{ title }}</h1>
    <NuxtLink :to="{ path: '/', query: { locale } }" no-prefetch data-testid="booking-link">{{
      back
    }}</NuxtLink>
  </main>
</template>
