import { useEffect, useState, type RefObject } from "react"

/*
 * Once-only in-view flag. Defaults to visible (true) whenever observation is
 * impossible — prerender, missing IntersectionObserver — so content is never
 * hidden by the absence of JS.
 */
export function useInView(ref: RefObject<Element | null>, rootMargin = "-10% 0px"): boolean {
  const [inView, setInView] = useState(false)
  const [canObserve, setCanObserve] = useState(false)

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
      { rootMargin }
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref, rootMargin])

  return canObserve ? inView : true
}
