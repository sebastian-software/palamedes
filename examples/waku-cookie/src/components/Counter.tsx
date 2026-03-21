'use client';

import { useState } from "react"
import { plural } from "@palamedes/core/macro"
import { Trans } from "@palamedes/react/macro"
import type { Locale } from "../lib/i18n"
import { syncClientI18n } from "../lib/i18n"

export const Counter = ({ locale }: { locale: Locale }) => {
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
      <button className="button" onClick={() => setCount((value) => value + 1)} type="button">
        <Trans>Click me</Trans>
      </button>
    </section>
  )
}
