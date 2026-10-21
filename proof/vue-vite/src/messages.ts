import { plural, t } from "@palamedes/core/macro";

export function labels() {
  return {
    title: t`Plan your next trip`,
    description: t`A small Vue app, translated with Palamedes.`,
    name: t`Traveler name`,
    travelers: t`Travelers`,
    add: t`Add traveler`,
    remove: t`Remove traveler`,
    details: t`Show packing tip`,
  };
}

export function greeting(name: string) {
  return t`Welcome, ${name}!`;
}

export function travelerCount(count: number) {
  return plural(count, {
    "=0": "No travelers yet",
    one: "# traveler ready",
    other: "# travelers ready",
  });
}
