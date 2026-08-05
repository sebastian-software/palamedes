"use client"

import { useRouter } from "next/navigation"

export function ClientNavigationProbe() {
  const router = useRouter()

  return (
    <button
      data-testid="open-lazy-client-probe"
      hidden
      onClick={() => router.push("/lazy-client-probe")}
      type="button"
    >
      Open lazy client probe
    </button>
  )
}
