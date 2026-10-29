import { bufferAnalytics, finishAnalyticsLoad, trackingDisabled } from "./analytics";

let script: HTMLScriptElement | undefined;
let loaded = false;
let reportedPath: string | undefined;

/** Own pageviews by pathname; older SDKs count query/anchor changes as SPA visits. */
export function reportPageview({ newVisit = false }: { newVisit?: boolean } = {}) {
  if (newVisit) reportedPath = undefined;
  if (!loaded || trackingDisabled() || reportedPath === location.pathname) return;
  try {
    if (!window.rybbit) return;
    window.rybbit.pageview();
    reportedPath = location.pathname;
  } catch {
    // A failed analytics request must not interrupt navigation.
  }
}

export function enableAnalytics(): boolean {
  if (import.meta.env.DEV || location.hostname !== "palamedes.dev" || trackingDisabled())
    return false;
  const src = import.meta.env.VITE_RYBBIT_SCRIPT_URL;
  const siteId = import.meta.env.VITE_RYBBIT_SITE_ID;
  if (!src || !siteId) return false;
  if (!script) {
    try {
      const url = new URL(src);
      if (url.protocol !== "https:") return false;
      url.searchParams.set("siteId", siteId);
      script = document.createElement("script");
      script.src = url.href;
      script.async = true;
      script.dataset.siteId = siteId;
      bufferAnalytics();
      script.addEventListener(
        "load",
        () => {
          loaded = true;
          reportPageview();
          finishAnalyticsLoad();
        },
        { once: true },
      );
      script.addEventListener("error", finishAnalyticsLoad, { once: true });
      document.head.append(script);
    } catch {
      return false;
    }
  }
  return true;
}
