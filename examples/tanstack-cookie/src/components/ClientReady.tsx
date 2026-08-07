import { useEffect, useState } from "react"
import { Trans } from "@palamedes/react/macro"

/** Renders a hidden marker once the app has hydrated, for browser verification. */
export function ClientReady() {
  const [ready, setReady] = useState(false)
  useEffect(() => setReady(true), [])
  if (!ready) {
    return null
  }
  return (
    <>
      <span data-testid="client-ready" hidden />
      <span data-testid="client-locale-value" hidden>
        <Trans>Add to cart</Trans>
      </span>
    </>
  )
}
