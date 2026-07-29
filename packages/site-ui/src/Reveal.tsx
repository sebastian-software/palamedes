import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react"

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)"

function subscribeToReducedMotion(callback: () => void) {
  const mediaQuery = window.matchMedia(REDUCED_MOTION_QUERY)
  mediaQuery.addEventListener("change", callback)
  return () => mediaQuery.removeEventListener("change", callback)
}

function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeToReducedMotion,
    () => window.matchMedia(REDUCED_MOTION_QUERY).matches,
    () => true
  )
}

/*
 * Prerendered, no-JS, and reduced-motion output is already in its final state.
 * Animation opts in only after hydration and only where observation exists.
 */
export function Reveal({ children, delayMs = 0 }: { children: ReactNode; delayMs?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const [inView, setInView] = useState(false)
  const [canObserve, setCanObserve] = useState(false)
  const reducedMotion = usePrefersReducedMotion()

  useEffect(() => {
    const element = ref.current
    if (!element || typeof IntersectionObserver === "undefined") {
      return
    }

    setCanObserve(true)
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setInView(true)
          observer.disconnect()
        }
      },
      { rootMargin: "-10% 0px" }
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const animate = !reducedMotion && canObserve

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
