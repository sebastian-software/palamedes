import { Errored, Loading, Show, createSignal, lazy } from "solid-js";

const LazyCatalogDetails = lazy(() => import("./LazyCatalogDetails"));

function LazyDetailsBoundary() {
  return (
    <Errored
      fallback={
        <p data-testid="lazy-catalog-error" role="alert">
          Details are temporarily unavailable. Reload the page to try again.
          <button type="button" onClick={() => window.location.reload()}>
            Reload page
          </button>
        </p>
      }
    >
      <Loading fallback={<p>Loading details…</p>}>
        <LazyCatalogDetails />
      </Loading>
    </Errored>
  );
}

export function LazyCatalogPanel() {
  const [open, setOpen] = createSignal(false);

  return (
    <section>
      <button onClick={() => setOpen((value) => !value)} type="button">
        Show lazy catalog details
      </button>
      <Show when={open()}>
        <LazyDetailsBoundary />
      </Show>
    </section>
  );
}
