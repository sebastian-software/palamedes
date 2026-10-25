import { createRouter } from "@tanstack/solid-router";
import { routeTree } from "./routeTree.gen";
export function getRouter() {
  return createRouter({
    routeTree,
    scrollRestoration: true,
    defaultErrorComponent: () => (
      <main role="alert">
        <h1>This page is temporarily unavailable.</h1>
        <button type="button" onClick={() => window.location.reload()}>
          Reload page
        </button>
      </main>
    ),
  });
}
declare module "@tanstack/solid-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
