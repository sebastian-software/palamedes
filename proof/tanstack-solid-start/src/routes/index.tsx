import { createFileRoute, Link } from "@tanstack/solid-router";
import { createSignal, For, lazy, Show } from "solid-js";
import { t } from "@palamedes/core/macro";
import { Trans } from "@palamedes/solid/macro";
import { status } from "../server-functions";
const LazyMessage = lazy(() => import("../components/lazy-message"));
export const Route = createFileRoute("/")({ component: Home });
function Home() {
  const [result, setResult] = createSignal<Awaited<ReturnType<typeof status>>>();
  const [loaded, setLoaded] = createSignal(false);
  return (
    <main>
      <h1>
        <Trans>TanStack Solid Start request scope</Trans>
      </h1>
      <p data-testid="server-message">{t`Server render confirmed locale.`}</p>
      <div role="group" aria-label="Language">
        <For each={["en", "de", "fr"]}>
          {(locale) => (
            <button
              type="button"
              data-testid={`locale-${locale}`}
              onClick={() => {
                document.cookie = `locale=${locale}; Path=/; SameSite=Lax`;
                window.location.reload();
              }}
            >
              {locale}
            </button>
          )}
        </For>
      </div>
      <button
        type="button"
        data-testid="server-trigger"
        onClick={async () => setResult(await status())}
      >
        Run server function
      </button>
      <output data-testid="server-result">{JSON.stringify(result())}</output>
      <button type="button" data-testid="lazy-trigger" onClick={() => setLoaded(true)}>
        Load browser fragment
      </button>
      <Show when={loaded()}>
        <LazyMessage />
      </Show>
      <Link to="/details" data-testid="details-link">
        Details
      </Link>
    </main>
  );
}
