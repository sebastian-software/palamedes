/// <reference types="filesystem-routing/types" />

import { Errored, Loading } from "solid-js";
import { createRouter } from "@solidjs/router";
import { fileRoutes } from "@solidjs/router/fs";
import { pageRoutes } from "virtual:file-routes";
import "@palamedes/example-ui/styles.css";

const Router = createRouter({ routes: fileRoutes(pageRoutes) });

export default function App() {
  return (
    <Errored
      fallback={
        <main class="error-state">
          <h1>Translations unavailable</h1>
          <p>Reload this page to try loading the active locale again.</p>
          <button type="button" onClick={() => window.location.reload()}>
            Reload
          </button>
        </main>
      }
    >
      <Router>{(props) => <Loading>{props.children}</Loading>}</Router>
    </Errored>
  );
}
