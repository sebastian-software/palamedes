import type { ReactNode } from "react"

/*
 * Marketing page shell: only the hairline-framed column. Site-level chrome
 * lives in the root so documentation renderers can own their main landmark.
 */
export function Page({ children }: { children: ReactNode }) {
  return <div className="pmds-page">{children}</div>
}
