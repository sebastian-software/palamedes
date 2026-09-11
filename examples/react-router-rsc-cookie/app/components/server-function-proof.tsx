"use client";

import { Component, lazy, Suspense, useState, useTransition } from "react";

import { readLocalizedServerFunction } from "../lib/server-function";

const LazyBrowserMessage = lazy(() => import("./lazy-browser-message"));

class LazyBrowserMessageBoundary extends Component<
  { children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return (
        <div data-testid="lazy-browser-error" role="alert">
          <p>This localized fragment is temporarily unavailable.</p>
          <a href="">Reload page</a> <a href="/">Go home</a>
        </div>
      );
    }
    return this.props.children;
  }
}

type Proof = Awaited<ReturnType<typeof readLocalizedServerFunction>>;

export function ServerFunctionProof() {
  const [proof, setProof] = useState<Proof | null>(null);
  const [showLazyBrowserMessage, setShowLazyBrowserMessage] = useState(false);
  const [isPending, startTransition] = useTransition();

  function runProof() {
    startTransition(async () => {
      setProof(await readLocalizedServerFunction());
    });
  }

  return (
    <section>
      <button
        data-testid="lazy-browser-trigger"
        onClick={() => setShowLazyBrowserMessage(true)}
        type="button"
      >
        Load browser fragment
      </button>
      {showLazyBrowserMessage ? (
        <LazyBrowserMessageBoundary>
          <Suspense fallback={<output data-testid="lazy-browser-message">loading</output>}>
            <LazyBrowserMessage />
          </Suspense>
        </LazyBrowserMessageBoundary>
      ) : null}
      <button
        data-testid="server-function-trigger"
        disabled={isPending}
        onClick={runProof}
        type="button"
      >
        Run RSC Server Function
      </button>
      <output data-testid="server-function-direct">{proof?.direct ?? "waiting"}</output>
      <output data-testid="server-function-sync">{proof?.synchronous ?? "waiting"}</output>
      <output data-testid="server-function-async">{proof?.asynchronous ?? "waiting"}</output>
      <output data-testid="server-function-cross-module">{proof?.crossModule ?? "waiting"}</output>
      <output data-testid="server-function-default">{proof?.defaultParameter ?? "waiting"}</output>
    </section>
  );
}
