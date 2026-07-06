import { useEffect, useState } from "react"

import { usePrefersReducedMotion } from "./usePrefersReducedMotion"

/*
 * Animates the leading number of a stat string ("21.0×" → 0.0×…21.0×,
 * "5 × 4" animates only the first number). Returns the final string during
 * prerender, under reduced motion, and while inactive — the baked HTML always
 * shows the true value.
 */
export function useCountUp(target: string, active: boolean, durationMs = 900): string {
  const reducedMotion = usePrefersReducedMotion()
  const [display, setDisplay] = useState(target)

  useEffect(() => {
    if (reducedMotion || !active) {
      setDisplay(target)
      return
    }
    const match = /^(\d+(?:\.\d+)?)([\s\S]*)$/.exec(target)
    if (!match) {
      setDisplay(target)
      return
    }
    const finalValue = Number(match[1])
    const suffix = match[2]
    const decimals = match[1].includes(".") ? match[1].split(".")[1].length : 0
    let frame = 0
    const start = performance.now()
    const tick = (now: number) => {
      const progress = Math.min((now - start) / durationMs, 1)
      const eased = 1 - (1 - progress) ** 3
      setDisplay((finalValue * eased).toFixed(decimals) + suffix)
      if (progress < 1) {
        frame = requestAnimationFrame(tick)
      }
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [target, active, durationMs, reducedMotion])

  return display
}
