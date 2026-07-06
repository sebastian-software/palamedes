import type { ReactNode } from "react"

/*
 * Marketing page shell: just the hairline-framed column. Header and footer
 * come from the ARDO chrome in root.tsx — rendering them here again is what
 * caused the duplicated site header after the ARDO migration.
 */
export function Page({ children }: { children: ReactNode }) {
  return <div className="frame min-h-screen">{children}</div>
}
