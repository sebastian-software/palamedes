import { useRef, type ReactNode } from "react"

import { useInView } from "~/hooks/useInView"
import { usePrefersReducedMotion } from "~/hooks/usePrefersReducedMotion"

/*
 * Scroll-reveal wrapper. The prerendered/no-JS/reduced-motion state is the
 * final state — animation only opts in after hydration for elements that are
 * still below the fold.
 */
export function Reveal({ children, delayMs = 0 }: { children: ReactNode; delayMs?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref)
  const reducedMotion = usePrefersReducedMotion()
  const animate = !reducedMotion

  return (
    <div
      ref={ref}
      style={
        animate
          ? {
              opacity: inView ? 1 : 0,
              transform: inView ? "translateY(0)" : "translateY(8px)",
              transition: `opacity 400ms ease-out ${delayMs}ms, transform 400ms ease-out ${delayMs}ms`,
            }
          : undefined
      }
    >
      {children}
    </div>
  )
}
