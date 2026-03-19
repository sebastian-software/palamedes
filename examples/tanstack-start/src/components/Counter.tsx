import { useState } from "react"
import { plural } from "@palamedes/core/macro"
import { Trans } from "@palamedes/react/macro"
import { syncClientI18n, type Locale } from "../lib/i18n"

interface CounterProps {
  locale: Locale
}

export function Counter({ locale }: CounterProps) {
  syncClientI18n(locale)
  const [count, setCount] = useState(0)

  return (
    <section className="panel">
      <p className="kicker">
        <Trans>Client interaction</Trans>
      </p>
      <h2>
        <Trans>Counter Example</Trans>
      </h2>
      <p className="muted">
        {plural(count, {
          one: "You clicked # time",
          other: "You clicked # times",
        })}
      </p>
      <button className="button" onClick={() => setCount((value) => value + 1)}>
        <Trans>Click me</Trans>
      </button>
    </section>
  )
}
