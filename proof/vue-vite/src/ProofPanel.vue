<script setup lang="ts">
import { ref } from "vue";
import { plural, t } from "@palamedes/core/macro";
import { EVENT } from "@palamedes/example-ui";

const when = new Date(EVENT.startsAt);
const seats = EVENT.seatsLeft;
const copy = {
  title: t`Behind the scenes`,
  description: t`one switch, every format`,
  plural: t`Plural`,
  currency: t`Currency`,
  number: t`Number`,
  date: t`Date`,
  runtime: t`Client`,
  refresh: t`Refresh client result`,
  seats: plural(seats, { one: "# seat left", other: "# seats left" }),
  price: t({ message: "{amount, number, ::currency/EUR}" }, { amount: EVENT.ticketPrice }),
  attendees: t({ message: "{count, number}" }, { count: EVENT.attendeeCount }),
  when: t({ message: "{when, date, medium}" }, { when }),
};
const message = ref(t`Client runtime confirmed locale.`);

function refresh() {
  message.value = t`Client runtime confirmed locale.`;
}
</script>

<template>
  <aside class="aside">
    <div class="aside-head">
      <h3>{{ copy.title }}</h3>
      <span>{{ copy.description }}</span>
    </div>
    <div class="feat">
      <div class="feat-row">
        <span class="feat-name">{{ copy.plural }}</span
        ><span class="feat-out">{{ copy.seats }}</span>
      </div>
      <code>plural(seats, { one: "# seat left", other: "# seats left" })</code>
    </div>
    <div class="feat">
      <div class="feat-row">
        <span class="feat-name">{{ copy.currency }}</span
        ><span class="feat-out">{{ copy.price }}</span>
      </div>
      <code>{amount, number, ::currency/EUR}</code>
    </div>
    <div class="feat">
      <div class="feat-row">
        <span class="feat-name">{{ copy.number }}</span
        ><span class="feat-out">{{ copy.attendees }}</span>
      </div>
      <code>{count, number}</code>
    </div>
    <div class="feat">
      <div class="feat-row">
        <span class="feat-name">{{ copy.date }}</span
        ><span class="feat-out is-text">{{ copy.when }}</span>
      </div>
      <code>{when, date, medium}</code>
    </div>
    <div class="feat">
      <div class="feat-row">
        <span class="feat-name">{{ copy.runtime }}</span
        ><span class="feat-out is-text" data-testid="client-proof-message">{{ message }}</span>
      </div>
      <button class="cta" data-testid="client-proof-trigger" type="button" @click="refresh">
        {{ copy.refresh }}
      </button>
    </div>
  </aside>
</template>
