<script setup lang="ts">
import { ref } from "vue";
import { plural, t } from "@palamedes/core/macro";
import { EVENT } from "@palamedes/example-ui";

const quantity = ref(1);
const cartMessage = ref("");
const when = new Date(EVENT.startsAt);
const seats = EVENT.seatsLeft;
const copy = {
  pass: t`Conference pass`,
  date: t`Date`,
  venue: t`Venue`,
  attendees: t`Attendees`,
  availability: t`Availability`,
  city: t`Berlin, Germany`,
  each: t`each`,
  total: t`Total`,
  add: t`Add to cart`,
  fewer: t`Fewer tickets`,
  more: t`More tickets`,
  dateValue: t({ message: "{when, date, full}" }, { when }),
  timeValue: t({ message: "{when, time, short}" }, { when }),
  attendeeCount: t({ message: "{count, number}" }, { count: EVENT.attendeeCount }),
  seats: plural(seats, { one: "# seat left", other: "# seats left" }),
};

function ticketLabel(quantity: number) {
  return plural(quantity, { one: "# ticket", other: "# tickets" });
}

function currency(amount: number) {
  return t({ message: "{amount, number, ::currency/EUR}" }, { amount });
}

function addToCart() {
  const count = quantity.value;
  cartMessage.value = plural(count, {
    one: "Added # ticket to your cart.",
    other: "Added # tickets to your cart.",
  });
}
</script>

<template>
  <article class="ticket">
    <div class="ticket-head">
      <p class="kicker">{{ copy.pass }}</p>
      <h2>{{ EVENT.eventTitle }}</h2>
    </div>
    <div class="facts">
      <div class="fact">
        <p class="fact-label">{{ copy.date }}</p>
        <p class="fact-value">
          {{ copy.dateValue }}<small>{{ copy.timeValue }}</small>
        </p>
      </div>
      <div class="fact">
        <p class="fact-label">{{ copy.venue }}</p>
        <p class="fact-value">
          {{ EVENT.venueName }}<small>{{ copy.city }}</small>
        </p>
      </div>
      <div class="fact">
        <p class="fact-label">{{ copy.attendees }}</p>
        <p class="fact-value">{{ copy.attendeeCount }}</p>
      </div>
      <div class="fact">
        <p class="fact-label">{{ copy.availability }}</p>
        <p class="fact-value">
          <span class="avail"><span class="pulse" aria-hidden="true" />{{ copy.seats }}</span>
        </p>
      </div>
    </div>
    <div class="buy">
      <div class="qty-row">
        <span class="qty-label"
          ><b data-testid="ticket-count">{{ ticketLabel(quantity) }}</b> ·
          {{ currency(EVENT.ticketPrice) }} {{ copy.each }}</span
        >
        <div class="stepper">
          <button
            :aria-label="copy.fewer"
            :disabled="quantity === 1"
            type="button"
            @click="quantity--"
          >
            −
          </button>
          <span class="stepper-num">{{ quantity }}</span>
          <button
            :aria-label="copy.more"
            :disabled="quantity === EVENT.maxQuantity"
            type="button"
            @click="quantity++"
          >
            +
          </button>
        </div>
      </div>
      <div class="total-row">
        <span class="total-label">{{ copy.total }}</span
        ><span class="total-value" data-testid="ticket-total">{{
          currency(EVENT.ticketPrice * quantity)
        }}</span>
      </div>
      <button class="cta" type="button" @click="addToCart">{{ copy.add }}</button>
      <p v-if="cartMessage" role="status" data-testid="cart-message">{{ cartMessage }}</p>
    </div>
  </article>
</template>
