"use client";

import { Component, type ReactNode } from "react";

/** Ordinary host error UI remains usable when a child cannot load or render. */
export class HostErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  public override state = { failed: false };

  public static getDerivedStateFromError() {
    return { failed: true };
  }

  public override render() {
    if (this.state.failed) {
      return (
        <main role="alert" data-palamedes-catalog-error>
          <h1>This page is temporarily unavailable.</h1>
          <p>Reload the page to try again.</p>
          <button type="button" onClick={() => window.location.reload()}>
            Reload page
          </button>
        </main>
      );
    }
    return this.props.children;
  }
}
