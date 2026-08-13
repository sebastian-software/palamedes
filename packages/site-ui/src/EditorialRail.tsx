import type { ReactNode } from "react"

export type EditorialRailTone = "structural" | "emphasis"

/**
 * A restrained editorial grouping for qualifications, positions, and asides.
 * Structural rails use ink-gray; bronze is reserved for semantic emphasis.
 */
export function EditorialRail({
  children,
  tone = "structural",
  className = "",
}: {
  children: ReactNode
  tone?: EditorialRailTone
  className?: string
}) {
  return (
    <aside className={`pmds-editorial-rail pmds-editorial-rail--${tone} ${className}`}>
      {children}
    </aside>
  )
}
