"use client"

import { useState } from "react"
import { plural } from "@lingui/core/macro"
import { Trans } from "@lingui/react/macro"

export function Counter() {
  const [count, setCount] = useState(0)

  return (
    <section style={{ marginTop: "2rem" }}>
      <h2>
        <Trans>Counter Example</Trans>
      </h2>
      <p>
        {plural(count, {
          one: "You clicked # time",
          other: "You clicked # times",
        })}
      </p>
      <button
        onClick={() => setCount((c) => c + 1)}
        style={{
          padding: "0.75rem 1.5rem",
          fontSize: "1rem",
          background: "#0066cc",
          color: "white",
          border: "none",
          borderRadius: "4px",
          cursor: "pointer",
        }}
      >
        <Trans>Click me</Trans>
      </button>
    </section>
  )
}
