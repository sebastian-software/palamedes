<script setup lang="ts">
import { computed, defineAsyncComponent, ref } from "vue";

import { greeting, labels, travelerCount } from "./messages";

const PackingTip = defineAsyncComponent(() => import("./PackingTip.vue"));
const copy = labels();
const name = ref("Alex");
const count = ref(1);
const showTip = ref(false);
const welcome = computed(() => greeting(name.value));
const summary = computed(() => travelerCount(count.value));
const locale = document.documentElement.lang;
const languages = { en: "English", fr: "Français", es: "Español" };

function localeHref(nextLocale: string) {
  const url = new URL(window.location.href);
  url.searchParams.set("locale", nextLocale);
  return `${url.pathname}${url.search}${url.hash}`;
}
</script>

<template>
  <main>
    <header>
      <a class="brand" href="/">Palamedes <span>× Vue</span></a>
      <nav aria-label="Language">
        <a
          v-for="(label, code) in languages"
          :key="code"
          :href="localeHref(code)"
          :lang="code"
          :aria-current="locale === code ? 'page' : undefined"
        >
          {{ label }}
        </a>
      </nav>
    </header>
    <section>
      <p class="eyebrow">Vue 3 + Vite · Integration spike</p>
      <h1>{{ copy.title }}</h1>
      <p class="description">{{ copy.description }}</p>
      <div class="planner">
        <label for="name">{{ copy.name }}</label>
        <input id="name" v-model="name" autocomplete="given-name" />
        <p class="welcome" data-testid="greeting">{{ welcome }}</p>
        <div class="travelers">
          <span>{{ copy.travelers }}</span>
          <div class="stepper">
            <button
              type="button"
              :aria-label="copy.remove"
              :disabled="count === 0"
              @click="count--"
            >
              −
            </button>
            <output>{{ count }}</output>
            <button type="button" :aria-label="copy.add" @click="count++">+</button>
          </div>
        </div>
        <p aria-live="polite" data-testid="traveler-count">{{ summary }}</p>
        <button v-if="!showTip" class="details" type="button" @click="showTip = true">
          {{ copy.details }}
        </button>
        <PackingTip v-if="showTip" />
      </div>
    </section>
  </main>
</template>
