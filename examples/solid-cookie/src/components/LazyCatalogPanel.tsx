import { Show, createErrorBoundary, createLoadingBoundary, createSignal, lazy } from "solid-js";

const LazyCatalogDetails = lazy(() => import("./LazyCatalogDetails"));

function LazyDetailsBoundary(): Element {
  return createErrorBoundary(
    () =>
      createLoadingBoundary(
        () => <LazyCatalogDetails />,
        () => <p>Loading details…</p>,
      ),
    () => (
      <p data-testid="lazy-catalog-error" role="alert">
        Details are temporarily unavailable. Reload the page to try again.
      </p>
    ),
  ) as unknown as Element;
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
