import { t } from "@palamedes/core/macro";
import { Component, lazy, Suspense, useState, type ReactNode } from "react";

const Details = lazy(() => import("../details"));
class CatalogBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  public state = { failed: false };
  public static getDerivedStateFromError() {
    return { failed: true };
  }
  public render() {
    if (this.state.failed)
      return (
        <main role="alert">
          <h1>This page is temporarily unavailable.</h1>
          <a href="?retry" target="_self">
            Reload page
          </a>{" "}
          <a href="/" target="_self">
            Go home
          </a>
        </main>
      );
    return this.props.children;
  }
}
export default function Home() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <h1>{t`Hello`}</h1>
      <button onClick={() => setOpen(true)}>Show details</button>
      <CatalogBoundary>
        <Suspense fallback={<p>Loading</p>}>{open && <Details />}</Suspense>
      </CatalogBoundary>
    </>
  );
}
