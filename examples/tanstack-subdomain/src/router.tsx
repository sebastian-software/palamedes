import { createRouter as createTanStackRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

function DefaultErrorComponent() {
  return (
    <main role="alert">
      <h1>This page is temporarily unavailable.</h1>
      <p>Reload the page to try again.</p>
      <button onClick={() => window.location.reload()} type="button">
        Reload page
      </button>
    </main>
  );
}

export function getRouter() {
  return createTanStackRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreload: "intent",
    defaultPreloadStaleTime: 0,
    defaultErrorComponent: DefaultErrorComponent,
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
