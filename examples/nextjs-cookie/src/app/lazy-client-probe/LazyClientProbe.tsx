"use client"

import { Trans } from "@palamedes/react/macro"

export function LazyClientProbe() {
  return (
    <output data-testid="lazy-client-message">
      <Trans>Loaded only after client navigation</Trans>
    </output>
  )
}
