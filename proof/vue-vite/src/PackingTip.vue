<script setup lang="ts">
import { packingTip } from "./packing";
</script>

<template>
  <p role="status" data-testid="packing-tip">{{ packingTip() }}</p>
</template>
