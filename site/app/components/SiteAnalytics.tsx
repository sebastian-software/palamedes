import { useEffect } from "ardo/react";
import { useArdoPath } from "ardo/runtime";
import { installInteractions, trackEvent } from "~/lib/analytics";
import { enableAnalytics, reportPageview } from "~/lib/analytics-bootstrap";

/** Own pathname pageviews and semantic actions in the shared site shell. */
export function SiteAnalytics() {
  const pathname = useArdoPath();
  useEffect(() => {
    if (!enableAnalytics()) return;
    reportPageview();
    let uninstall = installInteractions(document);
    const sent = new Set<number>();
    let scheduled = 0;
    let userScrolled = false;
    const arm = () => {
      userScrolled = true;
    };
    const key = (event: KeyboardEvent) => {
      if (
        !event.defaultPrevented &&
        ["PageDown", "PageUp", "Home", "End", "ArrowDown", "ArrowUp", " "].includes(event.key) &&
        (!(event.target instanceof Element) ||
          !event.target.closest('input, textarea, select, [contenteditable="true"]'))
      )
        arm();
    };
    const scrollbar = (event: PointerEvent) => {
      if (event.clientX >= document.documentElement.clientWidth) arm();
    };
    const scroll = () => {
      // Route transitions and history restoration can scroll before layout settles.
      if (!userScrolled || scheduled) return;
      scheduled = requestAnimationFrame(() => {
        scheduled = 0;
        const range = document.documentElement.scrollHeight - innerHeight;
        if (range <= 0) return;
        const percent = (scrollY / range) * 100;
        for (const threshold of [25, 50, 75, 100]) {
          if (percent + 0.5 >= threshold && !sent.has(threshold)) {
            sent.add(threshold);
            trackEvent("scroll_depth", { percent: threshold });
          }
        }
      });
    };
    const restore = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      reportPageview({ newVisit: true });
      uninstall();
      uninstall = installInteractions(document);
      sent.clear();
      userScrolled = false;
      cancelAnimationFrame(scheduled);
      scheduled = 0;
    };
    window.addEventListener("pageshow", restore);
    window.addEventListener("scroll", scroll, { passive: true });
    window.addEventListener("wheel", arm, { passive: true });
    window.addEventListener("touchmove", arm, { passive: true });
    window.addEventListener("keydown", key);
    window.addEventListener("pointerdown", scrollbar);
    return () => {
      uninstall();
      window.removeEventListener("pageshow", restore);
      cancelAnimationFrame(scheduled);
      window.removeEventListener("scroll", scroll);
      window.removeEventListener("wheel", arm);
      window.removeEventListener("touchmove", arm);
      window.removeEventListener("keydown", key);
      window.removeEventListener("pointerdown", scrollbar);
    };
  }, [pathname]);
  return null;
}
