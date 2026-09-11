"use client";

import { Component, lazy, Suspense, useState, type ReactNode } from "react";

const LazyCatalogDetails = lazy(() => import("./LazyCatalogDetails"));

class LazyLoadErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <p data-testid="lazy-catalog-error" role="alert">
          Details are temporarily unavailable. Reload the page to try again.
        </p>
      );
    }
    return this.props.children;
  }
}

export function LazyCatalogPanel() {
  const [open, setOpen] = useState(false);

  return (
    <section>
      <button onClick={() => setOpen((value) => !value)} type="button">
        Show lazy catalog details
      </button>
      {open ? (
        <LazyLoadErrorBoundary>
          <Suspense fallback={<p>Loading details…</p>}>
            <LazyCatalogDetails />
          </Suspense>
        </LazyLoadErrorBoundary>
      ) : null}
    </section>
  );
}
