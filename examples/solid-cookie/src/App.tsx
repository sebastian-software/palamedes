/// <reference types="filesystem-routing/types" />

import { Loading, createErrorBoundary } from "solid-js";
import { createRouter } from "@solidjs/router";
import { fileRoutes } from "@solidjs/router/fs";
import { pageRoutes } from "virtual:file-routes";
import "@palamedes/example-ui/styles.css";

const Router = createRouter({ routes: fileRoutes(pageRoutes) });

export default function App(): Element {
  return createErrorBoundary(
    () => <Router>{(props) => <Loading>{props.children}</Loading>}</Router>,
    () => (
      <main class="error-state">
        <h1>Translations unavailable</h1>
        <p>Reload this page to try loading the active locale again.</p>
        <button type="button" onClick={() => window.location.reload()}>
          Reload
        </button>
      </main>
    ),
  ) as unknown as Element;
}
