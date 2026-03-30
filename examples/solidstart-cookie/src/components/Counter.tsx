import { createSignal } from "solid-js"
import { plural } from "@palamedes/core/macro"
import { Trans } from "@palamedes/solid/macro"
import { syncClientI18n, type Locale } from "../lib/i18n"

interface CounterProps {
  locale: Locale
}

export function Counter(props: CounterProps) {
  syncClientI18n(props.locale)
  const [count, setCount] = createSignal(0)

  return (
    <section class="panel">
      <p class="kicker">
        <Trans>Client interaction</Trans>
      </p>
      <h2>
        <Trans>Counter example</Trans>
      </h2>
      <p class="muted">
        {plural(count(), {
          one: "You clicked # time",
          other: "You clicked # times",
        })}
      </p>
      <button class="button" onClick={() => setCount((value) => value + 1)} type="button">
        <Trans>Click me</Trans>
      </button>
    </section>
  )
}
