<script setup lang="ts">
import { t } from "@palamedes/core/macro";

const detail = t`Lazy catalog detail loaded.`;
</script>

<template>
  <p data-testid="lazy-catalog-details">{{ detail }}</p>
</template>
