"use client"

import { useEffect, useState } from "react"

/** Renders a hidden marker once the app has hydrated, for browser verification. */
export function ClientReady() {
  const [ready, setReady] = useState(false)
  useEffect(() => setReady(true), [])
  if (!ready) {
    return null
  }
  return <span data-testid="client-ready" hidden />
}
