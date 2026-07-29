import type { ReactNode } from "react"

export function Wordmark({
  children,
  className = "",
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <span className={`pmds-wordmark ${className}`} data-palamedes-wordmark>
      {children}
    </span>
  )
}
