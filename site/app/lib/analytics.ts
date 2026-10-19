export type AnalyticsProperties = Record<string, string | number>;
export type TrackEvent = (name: string, properties?: AnalyticsProperties) => void;

declare global {
  interface Window {
    rybbit?: { event: TrackEvent; pageview: () => void };
    __RYBBIT_OPTOUT__?: boolean;
  }
}

export function trackingDisabled(): boolean {
  if (window.__RYBBIT_OPTOUT__) return true;
  try {
    return localStorage.getItem("disable-rybbit") !== null;
  } catch {
    // Storage access is optional, including in private browsing.
    return false;
  }
}

let loading = false;
const pending: [string, AnalyticsProperties][] = [];

export function bufferAnalytics() {
  loading = true;
}

export function finishAnalyticsLoad() {
  loading = false;
  for (const [name, properties] of pending.splice(0)) trackEvent(name, properties);
}

/** The host page owns the SDK. Demos forward only explicitly named actions. */
export const trackEvent: TrackEvent = (name, properties = {}) => {
  if (trackingDisabled()) return;
  try {
    const data = { page: location.pathname, ...properties };
    if (window.rybbit) window.rybbit.event(name, data);
    else if (loading && pending.length < 50) pending.push([name, data]);
  } catch {
    // Analytics must never interrupt the action it measures.
  }
};

export function safeDestination(href: string, base = location.href): string | null {
  try {
    const url = new URL(href, base);
    if (url.protocol === "mailto:" || url.protocol === "tel:") return url.protocol;
    return /^https?:$/u.test(url.protocol) ? `${url.origin}${url.pathname}` : null;
  } catch {
    return null;
  }
}

/** Structural fallback for third-party/generated controls; never read input values. */
export function controlId(element: Element): string {
  const explicit = (element as HTMLElement).dataset.analyticsId;
  if (explicit) return explicit;
  const parts: string[] = [];
  let current: Element | null = element;
  while (current && current !== element.ownerDocument.body && parts.length < 8) {
    const parent: Element | null = current.parentElement;
    const index = parent ? [...parent.children].indexOf(current) + 1 : 1;
    parts.unshift(`${current.tagName.toLowerCase()}:${index}`);
    current = parent;
  }
  return parts.join("/");
}

export function placement(element: Element): string {
  return (
    element.closest<HTMLElement>("[data-analytics-placement]")?.dataset.analyticsPlacement ??
    (element.closest("header") ? "header" : element.closest("footer") ? "footer" : "content")
  );
}

export function installInteractions(doc: Document, track: TrackEvent = trackEvent): () => void {
  const view = doc.defaultView as Window & typeof globalThis;
  let searchUsed = false;
  const send = (name: string, element: Element, properties: AnalyticsProperties = {}) =>
    track(name, { control: controlId(element), placement: placement(element), ...properties });
  const searchInput = (target: Element) =>
    target.matches('[role="combobox"][aria-autocomplete="list"]');

  function click(event: MouseEvent) {
    const target = event.target instanceof view.Element ? event.target : null;
    const element = target?.closest<HTMLElement>(
      'a[href], button, summary, input[type="submit"], input[type="button"], input[type="reset"], [role="button"], [role="tab"]',
    );
    if (!element || element.matches(':disabled, [aria-disabled="true"]')) return;
    const custom = element.dataset.analyticsEvent;
    const props = element.dataset.analyticsValue;
    if (custom) {
      send(custom, element, props ? { value: props } : {});
      return;
    }
    if (element instanceof view.HTMLAnchorElement) {
      const destination = safeDestination(element.href);
      if (!destination) return;
      send(element.getAttribute("role") === "option" ? "search_result" : "link_click", element, {
        destination,
        external: Number(new URL(element.href).origin !== location.origin),
        anchor: Number(element.hash.length > 0),
      });
    } else if (element.tagName === "SUMMARY") {
      send("disclosure_toggle", element, { expanded: Number(!element.closest("details")?.open) });
    } else if (element.getAttribute("role") === "tab") {
      // Observe selection below so arrow-key activation is counted too.
      return;
    } else if (/^(Copy code|Copied!)$/u.test(element.getAttribute("aria-label") ?? "")) {
      send("code_copy", element);
    } else {
      send("button_click", element);
    }
  }

  function input(event: Event) {
    const target = event.target;
    if (!(target instanceof view.Element)) return;
    if (searchInput(target) && !searchUsed) {
      searchUsed = true;
      send("search_use", target);
    }
  }

  function keydown(event: KeyboardEvent) {
    const target = event.target;
    if (event.key !== "Enter" || !(target instanceof view.Element) || !searchInput(target)) return;
    const selected = doc.getElementById(target.getAttribute("aria-activedescendant") ?? "");
    if (!(selected instanceof view.HTMLAnchorElement)) return;
    const destination = safeDestination(selected.href);
    if (destination) send("search_result", selected, { destination, method: "keyboard" });
  }

  function change(event: Event) {
    const target = event.target;
    if (!(target instanceof view.Element) || searchInput(target)) return;
    if (!target.matches('select, input:not([type="password"]):not([type="hidden"]), textarea'))
      return;
    send("control_change", target);
  }

  function submit(event: Event) {
    if (event.target instanceof view.HTMLFormElement) send("form_submit", event.target);
  }

  const selection = new view.MutationObserver((records) => {
    for (const record of records) {
      const tab = record.target as HTMLElement;
      if (
        record.oldValue === "false" &&
        tab.getAttribute("role") === "tab" &&
        tab.getAttribute("aria-selected") === "true"
      ) {
        send("tab_select", tab, { value: tab.dataset.ardoTabValue ?? controlId(tab) });
      }
    }
  });
  selection.observe(doc, {
    subtree: true,
    attributes: true,
    attributeFilter: ["aria-selected"],
    attributeOldValue: true,
  });

  // Capture runs before React navigation replaces the clicked element.
  doc.addEventListener("click", click, true);
  doc.addEventListener("input", input, true);
  doc.addEventListener("keydown", keydown, true);
  doc.addEventListener("change", change, true);
  doc.addEventListener("submit", submit, true);
  return () => {
    selection.disconnect();
    doc.removeEventListener("click", click, true);
    doc.removeEventListener("input", input, true);
    doc.removeEventListener("keydown", keydown, true);
    doc.removeEventListener("change", change, true);
    doc.removeEventListener("submit", submit, true);
  };
}
