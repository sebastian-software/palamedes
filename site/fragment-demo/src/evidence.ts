export const VIEWS = ["overview", "projects", "billing"] as const;
export type View = (typeof VIEWS)[number];
export interface Fragment {
  file: string;
  view: View;
  bytes: number;
  ids: string[];
}
export interface Evidence {
  fragments: Fragment[];
  whole: { file: string; bytes: number; messages: number };
}
export interface LoadEvent extends Fragment {
  phase: string;
  started: number;
}

// Resource Timing includes the entry fragments that finished before React mounted.
// Match only this build's active-locale assets; inspecting them never fetches them.
export function observeFragments(
  evidence: Evidence,
  phase: (started: number) => string,
  onLoad: (event: LoadEvent) => void,
) {
  const seen = new Set<string>();
  const record = (entry: PerformanceEntry) => {
    const pathname = new URL(entry.name).pathname;
    const fragment = evidence.fragments.find(({ file }) => pathname === `/fragment-demo/${file}`);
    if (!fragment || seen.has(fragment.file)) return;
    const resource = entry as PerformanceResourceTiming;
    if (resource.responseStatus >= 400 || resource.decodedBodySize === 0) return;
    seen.add(fragment.file);
    onLoad({ ...fragment, phase: phase(entry.startTime), started: entry.startTime });
  };
  performance.getEntriesByType("resource").forEach(record);
  if (typeof PerformanceObserver === "undefined") return () => {};
  const observer = new PerformanceObserver((list) => list.getEntries().forEach(record));
  observer.observe({ type: "resource", buffered: true });
  return () => observer.disconnect();
}

export function formatBytes(bytes: number) {
  return `${(bytes / 1024).toFixed(2)} KiB`;
}
