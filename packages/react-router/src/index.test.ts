import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { getI18n, resetI18nRuntime, type I18nInstance } from "@palamedes/runtime";
import type * as RuntimeServer from "@palamedes/runtime/server";
import { createElement } from "react";
import {
  createRequestHandler,
  RouterContextProvider,
  useLoaderData,
  type ServerBuild,
} from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createReactRouterI18n, type CreateReactRouterI18nOptions } from "./index";

const runtimeServer = vi.hoisted(() => ({ scopes: 0 }));

vi.mock("@palamedes/runtime/server", async (importOriginal) => {
  const original = await importOriginal<typeof RuntimeServer>();
  return {
    ...original,
    createServerI18nScope(...args: Parameters<typeof original.createServerI18nScope>) {
      runtimeServer.scopes += 1;
      return original.createServerI18nScope(...args);
    },
  };
});

// The Vite plugin supplies the generated catalogs in a real server build.
vi.mock("@palamedes/runtime/server/bundled", () => ({
  async createBundledServerI18n(options: { locale: string; timeZone?: string }) {
    await Promise.resolve();
    if (options.locale === "fr") throw new Error("catalog fr is unavailable");
    return createTestI18n(options.locale, options.timeZone);
  },
}));

function unusedRenderMessage(): never {
  throw new Error("renderMessage is not used by these tests.");
}

function createTestI18n(locale: string, timeZone = "UTC"): I18nInstance {
  return {
    locale,
    _: (message: string) => `${locale}[${timeZone}]:${message}`,
    load() {},
    activate() {},
    renderMessage: unusedRenderMessage,
  };
}

const fixtureDirectories: string[] = [];

afterEach(async () => {
  resetI18nRuntime();
  await Promise.all(
    fixtureDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

function localeFromRequest(request: Request): string {
  return new URL(request.url).searchParams.get("locale") ?? "en";
}

/** Two requests meet here, so the second starts before the first resumes. */
function createRendezvous() {
  let arrivals = 0;
  let release!: () => void;
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });
  return async () => {
    arrivals += 1;
    if (arrivals === 2) release();
    await ready;
  };
}

type TestApp = {
  handler: (request: Request) => Promise<Response>;
  errors: unknown[];
};

function createTestApp(
  options: Partial<CreateReactRouterI18nOptions> = {},
  loaderBarrier?: () => Promise<void>,
): TestApp & { i18n: ReturnType<typeof createReactRouterI18n> } {
  const i18n = createReactRouterI18n({
    resolveLocale: localeFromRequest,
    catalogDelivery: { development: true },
    ...options,
  });
  const errors: unknown[] = [];

  function Root() {
    const data = useLoaderData() as { loader: string; locale: string };
    return createElement(
      "html",
      { lang: data.locale },
      createElement("head"),
      createElement(
        "body",
        null,
        createElement("p", { id: "loader" }, data.loader),
        createElement("p", { id: "render" }, getI18n()._("render")),
      ),
    );
  }

  function ErrorBoundary() {
    return createElement(
      "html",
      null,
      createElement("head"),
      createElement("body", null, createElement("main", { role: "alert" }, "Unavailable")),
    );
  }

  const build: ServerBuild = {
    entry: {
      module: {
        default: i18n.handleRequest,
        handleError(error: unknown) {
          errors.push(error);
        },
      },
    },
    routes: {
      root: {
        id: "root",
        path: "",
        module: {
          default: Root,
          ErrorBoundary,
          middleware: [i18n.middleware],
          async loader({ context }) {
            await loaderBarrier?.();
            return { loader: getI18n()._("loader"), locale: i18n.getLocale(context) };
          },
          async action() {
            return { action: getI18n()._("action") };
          },
        },
      },
    },
    assets: {
      entry: { imports: [], module: "/entry.client.js" },
      routes: {
        root: {
          id: "root",
          path: "",
          module: "/root.js",
          hasAction: true,
          hasLoader: true,
          hasClientAction: false,
          hasClientLoader: false,
          hasClientMiddleware: false,
          hasErrorBoundary: true,
          clientActionModule: undefined,
          clientLoaderModule: undefined,
          clientMiddlewareModule: undefined,
          hydrateFallbackModule: undefined,
        },
      },
      url: "/manifest.js",
      version: "test",
    },
    publicPath: "/",
    assetsBuildDirectory: "build/client",
    future: {} as ServerBuild["future"],
    ssr: true,
    isSpaMode: false,
    prerender: [],
    routeDiscovery: { mode: "lazy", manifestPath: "/__manifest" },
  };

  const handle = createRequestHandler(build, "production");
  return { handler: (request) => handle(request), errors, i18n };
}

describe("createReactRouterI18n", () => {
  it("runs loaders and the document render of concurrent mixed-locale requests in one scope", async () => {
    runtimeServer.scopes = 0;
    const barrier = createRendezvous();
    const app = createTestApp({ i18nOptions: { timeZone: "Europe/Berlin" } }, barrier);

    const responses = await Promise.all(
      ["de", "en"].map((locale) =>
        app.handler(new Request(`https://example.test/?locale=${locale}`)),
      ),
    );
    const [de, en] = await Promise.all(responses.map((response) => response.text()));

    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expect(de).toContain('<html lang="de">');
    expect(de).toContain('<p id="loader">de[Europe/Berlin]:loader</p>');
    expect(de).toContain('<p id="render">de[Europe/Berlin]:render</p>');
    expect(en).toContain('<p id="loader">en[Europe/Berlin]:loader</p>');
    expect(en).toContain('<p id="render">en[Europe/Berlin]:render</p>');
    expect(runtimeServer.scopes).toBe(1);
    expect(app.errors).toEqual([]);
  });

  it("scopes concurrent data requests and actions without per-loader wrapping", async () => {
    const barrier = createRendezvous();
    const app = createTestApp({}, barrier);

    const [de, en] = await Promise.all(
      ["de", "en"].map((locale) =>
        app.handler(new Request(`https://example.test/_.data?locale=${locale}`)),
      ),
    );
    expect(await de.text()).toContain("de[UTC]:loader");
    expect(await en.text()).toContain("en[UTC]:loader");

    const action = await app.handler(
      new Request("https://example.test/_.data?locale=de", {
        method: "POST",
        body: new URLSearchParams(),
        headers: { origin: "https://example.test" },
      }),
    );
    expect(await action.text()).toContain("de[UTC]:action");
  });

  it("calls the locale resolver and creates the instance once per request", async () => {
    const resolveLocale = vi.fn(localeFromRequest);
    const i18nOptions = vi.fn(() => ({ timeZone: "UTC" }));
    const app = createTestApp({ resolveLocale, i18nOptions });

    const response = await app.handler(new Request("https://example.test/?locale=de"));
    expect(await response.text()).toContain("de[UTC]:render");
    expect(resolveLocale).toHaveBeenCalledTimes(1);
    expect(i18nOptions).toHaveBeenCalledWith(expect.any(Request), "de");
  });

  it("routes a catalog failure to the error boundary with the cause attached", async () => {
    const app = createTestApp({ failureMessage: "The page catalog could not be loaded." });

    const response = await app.handler(new Request("https://example.test/?locale=fr"));
    const html = await response.text();

    expect(response.status).toBe(500);
    expect(html).toContain('<main role="alert">Unavailable</main>');
    expect(app.errors).toHaveLength(1);
    const error = app.errors[0] as Error;
    expect(error.message).toBe("The page catalog could not be loaded.");
    expect((error.cause as Error).message).toBe("catalog fr is unavailable");
  });

  it("fails a data request when its catalog cannot load", async () => {
    const app = createTestApp();

    const response = await app.handler(new Request("https://example.test/_.data?locale=fr"));
    const body = await response.text();

    // Production mode sanitizes the serialized error; the handler gets the cause.
    expect(body).toContain('"error"');
    expect(body).toContain("Unexpected Server Error");
    expect(body).not.toContain("fr[UTC]:loader");
    expect((app.errors[0] as Error).message).toBe(
      "Palamedes React Router i18n initialization failed before the route handlers ran.",
    );
  });

  it("injects the active locale import map into production documents", async () => {
    const clientDirectory = await createClientBuild();
    const app = createTestApp({
      catalogDelivery: { clientDirectory, development: false },
      nonce: () => "nonce-1",
    });

    const response = await app.handler(new Request("https://example.test/?locale=de"));
    const html = await response.text();

    expect(response.headers.get("content-type")).toBe("text/html");
    expect(html).toContain(
      '<head><script type="importmap" nonce="nonce-1">{"imports":{"#pmds/root":"/assets/root.de.js"}}</script>',
    );
    expect(html).not.toContain("/assets/root.en.js");
  });

  it("covers documents that never reach route middleware", async () => {
    const clientDirectory = await createClientBuild();
    const app = createTestApp({ catalogDelivery: { clientDirectory, development: false } });

    // An unknown path matches no route, so React Router skips middleware and
    // renders the root error boundary straight through the server entry.
    const response = await app.handler(new Request("https://example.test/missing/page?locale=en"));
    const html = await response.text();

    expect(response.status).toBe(404);
    expect(html).toContain('{"imports":{"#pmds/root":"/assets/root.en.js"}}');
    expect(html).toContain('<main role="alert">Unavailable</main>');
  });

  it("leaves HTML untouched when catalog delivery is disabled", async () => {
    const app = createTestApp({ catalogDelivery: false });

    const html = await (await app.handler(new Request("https://example.test/?locale=en"))).text();

    expect(html).not.toContain("importmap");
    expect(html).toContain("en[UTC]:render");
  });

  it("answers HEAD requests without a body", async () => {
    const app = createTestApp();

    const response = await app.handler(
      new Request("https://example.test/?locale=en", { method: "HEAD" }),
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("");
  });

  it("reports a missing root middleware", () => {
    const i18n = createReactRouterI18n({ resolveLocale: () => "en" });

    expect(() => i18n.getLocale(new RouterContextProvider())).toThrow(
      "Export `middleware = [i18n.middleware]` from app/root.tsx",
    );
  });

  it("runs custom entry work inside the request scope", async () => {
    const i18n = createReactRouterI18n({
      resolveLocale: () => "es",
      catalogDelivery: { development: true },
    });
    const context = new RouterContextProvider();

    const message = await i18n.run(new Request("https://example.test/"), context, async () => {
      await Promise.resolve();
      return getI18n()._("custom");
    });

    expect(message).toBe("es[UTC]:custom");
    expect(i18n.getLocale(context)).toBe("es");
    expect(() => getI18n()).toThrow("No active server i18n instance");
  });
});

async function createClientBuild(): Promise<string> {
  const clientDirectory = await mkdtemp(path.join(os.tmpdir(), "palamedes-react-router-client-"));
  fixtureDirectories.push(clientDirectory);
  await writeFile(
    path.join(clientDirectory, "palamedes-split-manifest.json"),
    JSON.stringify({
      locales: ["en", "de"],
      importMaps: { en: "palamedes-importmap.en.json", de: "palamedes-importmap.de.json" },
      chunkImports: {},
    }),
  );
  for (const locale of ["en", "de"]) {
    await writeFile(
      path.join(clientDirectory, `palamedes-importmap.${locale}.json`),
      JSON.stringify({ imports: { "#pmds/root": `/assets/root.${locale}.js` } }),
    );
  }
  return clientDirectory;
}
