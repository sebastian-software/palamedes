import type { ReactNode } from "react"

import { SiteFooter } from "./SiteFooter"
import { SiteNav } from "./SiteNav"

/* Standard page shell: sticky nav, the hairline-framed column, footer. */
export function Page({ children }: { children: ReactNode }) {
  return (
    <>
      <SiteNav />
      <main className="frame min-h-screen">{children}</main>
      <div className="frame border-t-0">
        <SiteFooter />
      </div>
    </>
  )
}
