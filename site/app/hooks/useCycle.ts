import { useEffect, useState } from "react"

import { usePrefersReducedMotion } from "./usePrefersReducedMotion"

/*
 * Interval-based index cycler for the locale cycle and terminal sequence.
 * Paused under reduced motion, while the tab is hidden, and while `active`
 * is false (e.g. out of view).
 */
export function useCycle(length: number, intervalMs: number, active = true): number {
  const reducedMotion = usePrefersReducedMotion()
  const [index, setIndex] = useState(0)

  useEffect(() => {
    if (reducedMotion || !active || length <= 1) {
      return
    }
    let timer: ReturnType<typeof setInterval> | undefined
    const start = () => {
      timer = setInterval(() => setIndex((i) => (i + 1) % length), intervalMs)
    }
    const stop = () => {
      if (timer) {
        clearInterval(timer)
      }
    }
    const onVisibility = () => {
      stop()
      if (!document.hidden) {
        start()
      }
    }
    start()
    document.addEventListener("visibilitychange", onVisibility)
    return () => {
      stop()
      document.removeEventListener("visibilitychange", onVisibility)
    }
  }, [length, intervalMs, active, reducedMotion])

  return reducedMotion ? 0 : index
}
