import type { ReactNode } from "react"

export default function Layout({ children }: { children: ReactNode }) {
  return <main className="page-shell">{children}</main>
}
