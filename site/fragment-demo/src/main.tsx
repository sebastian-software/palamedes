import { useEffect, useRef, useState, type ComponentType } from "react";
import { createRoot } from "react-dom/client";
import Overview from "./views/overview";
import {
  VIEWS,
  formatBytes,
  observeFragments,
  type Evidence,
  type LoadEvent,
  type View,
} from "./evidence";
import "./styles.css";

const locale = document.documentElement.lang;
const loaders = {
  overview: async () => ({ default: Overview }),
  projects: () => import("./views/projects"),
  billing: () => import("./views/billing"),
};
const labels = { overview: "Overview", projects: "Projects", billing: "Billing" };

function Demo({ evidence }: { evidence: Evidence }) {
  const [view, setView] = useState<View>("overview");
  const [content, setContent] = useState<ComponentType>(() => Overview);
  const Content = content;
  const [events, setEvents] = useState<LoadEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const phases = useRef([{ started: 0, label: "Entry" }]);
  const loadedIds = new Set(events.flatMap((event) => event.ids));
  const bytes = events.reduce((total, event) => total + event.bytes, 0);

  useEffect(
    () =>
      observeFragments(
        evidence,
        (started) => phases.current.filter((phase) => phase.started <= started).at(-1)!.label,
        (event) => {
          setEvents((previous) => [...previous, event].sort((a, b) => a.started - b.started));
        },
      ),
    [evidence],
  );

  useEffect(() => {
    const observer = new ResizeObserver(() => {
      parent.postMessage(
        {
          type: "palamedes:demo-height",
          height: document.getElementById("root")!.getBoundingClientRect().height,
        },
        location.origin,
      );
    });
    observer.observe(document.getElementById("root")!);
    return () => observer.disconnect();
  }, []);

  async function navigate(next: View) {
    phases.current.push({ started: performance.now(), label: `Navigation · ${labels[next]}` });
    setLoading(true);
    setError(false);
    try {
      const module = await loaders[next]();
      setContent(() => module.default);
      setView(next);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="demo" lang="en">
      <header className="demo-toolbar">
        <div>
          <p className="micro">Live Vite / React build</p>
          <h1>Follow the messages.</h1>
        </div>
        <div className="locale-links" aria-label="Demo language">
          <a href="en.html" aria-current={locale === "en" ? "page" : undefined}>
            English
          </a>
          <a href="fr.html" aria-current={locale === "fr" ? "page" : undefined} lang="fr">
            Français
          </a>
          <a href={`${locale}.html`}>Restart</a>
        </div>
      </header>
      <div className="demo-grid">
        <section className="workspace" aria-label="Example workspace">
          <p className="micro">Try another view</p>
          <nav aria-label="Workspace views">
            {VIEWS.map((name) => (
              <button
                key={name}
                type="button"
                disabled={loading}
                aria-current={view === name ? "page" : undefined}
                onClick={() => void navigate(name)}
              >
                {labels[name]}
              </button>
            ))}
          </nav>
          <div className="workspace-content" lang={locale} aria-busy={loading}>
            <Content />
          </div>
          <p role="status">
            {loading ? "Loading the view and its messages…" : `Showing ${labels[view]} · ${locale}`}
          </p>
          {error && (
            <div role="alert">
              <p>This view could not load. The previous view is still available.</p>
              <a href={`${locale}.html`}>Reload the demo to try again</a>
            </div>
          )}
        </section>
        <section className="inspector" aria-label="Translation delivery">
          <p className="micro">Active document locale · {locale}</p>
          <dl className="delivery-stats">
            <div>
              <dt>Loaded so far</dt>
              <dd data-loaded-messages>
                {loadedIds.size} / {evidence.whole.messages} messages
              </dd>
              <dd data-loaded-bytes>{formatBytes(bytes)}</dd>
            </div>
            <div>
              <dt>Whole locale catalog</dt>
              <dd>{evidence.whole.messages} messages</dd>
              <dd>{formatBytes(evidence.whole.bytes)}</dd>
            </div>
          </dl>
          <ul className="fragment-states" aria-label="Fragment state">
            {VIEWS.map((name) => (
              <li key={name}>
                <span>{labels[name]}</span>
                <strong>
                  {events.some((event) => event.view === name) ? "Loaded" : "Deferred"}
                </strong>
              </li>
            ))}
          </ul>
          <p>
            Only {locale === "en" ? "English" : "French"} fragments belong to this document.
            Changing language loads a new document.
          </p>
        </section>
      </div>
      <section className="load-ledger" aria-label="Observed fragment loads">
        <h2>What this browser loaded</h2>
        <p>
          Entry fragments arrive before the first view runs. Navigate to add a view; returning to it
          reuses the module.
        </p>
        <ol>
          {events.map((event) => (
            <li key={event.file} data-fragment={event.view}>
              <strong>{event.phase}</strong>
              <span>
                {event.ids.length} messages · {formatBytes(event.bytes)}
              </span>
              <a href={event.file} target="_blank" rel="noreferrer">
                {event.file.split("/").at(-1)}
              </a>
            </li>
          ))}
        </ol>
        {events.length === 0 && (
          <p role="status">
            Waiting for Resource Timing entries. If this browser does not expose them, inspect the
            Network panel.
          </p>
        )}
      </section>
      <p className="measurement-note">
        Sizes are generated, uncompressed message-module source bytes. App code, the runtime, import
        maps, this inspector, compression, and HTTP overhead are excluded. The whole-catalog
        reference is compiled from the same messages and is not fetched by the demo. Splitting
        defers work; after visiting every view, fragment overhead can exceed one complete module.
        This small fixture is not a speed benchmark.
      </p>
      <a href={evidence.whole.file} target="_blank" rel="noreferrer">
        Inspect the whole-catalog reference
      </a>
    </main>
  );
}

const root = createRoot(document.getElementById("root")!);
fetch(`evidence.${locale}.json`)
  .then(async (response) => {
    if (!response.ok) throw new Error("Demo evidence is unavailable");
    return response.json() as Promise<Evidence>;
  })
  .then((evidence) => root.render(<Demo evidence={evidence} />))
  .catch(() => {
    root.render(
      <main lang="en" role="alert">
        <h1>The demo could not load.</h1>
        <p>Reload to try again.</p>
        <a href={`${locale}.html`}>Reload demo</a>
      </main>,
    );
  });
