import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { getI18n, resetI18nRuntime, type I18nInstance } from "@palamedes/runtime";
import type * as RuntimeServer from "@palamedes/runtime/server";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  createContext,
  createRequestHandler,
  RouterContextProvider,
  useLoaderData,
  useRouteLoaderData,
  type ServerBuild,
} from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useDocumentLocale } from "./document";
import {
  createReactRouterI18n,
  type CreateReactRouterI18nOptions,
  type ReactRouterContext,
} from "./index";

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
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
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
  handler: (request: Request, context?: RouterContextProvider) => Promise<Response>;
  errors: unknown[];
};

/**
 * The root `Layout` variants. `document` follows the guide: `<html lang>` from
 * `useDocumentLocale()` and a translated footer. `fallback` is the earlier
 * guide's root-loader-or-default pattern, which is wrong for a 404 in another
 * locale.
 */
type TestLayout = "document" | "fallback";

function createTestApp(
  options: Partial<CreateReactRouterI18nOptions> = {},
  loaderBarrier?: () => Promise<void>,
  layout?: TestLayout,
): TestApp & { i18n: ReturnType<typeof createReactRouterI18n> } {
  const i18n = createReactRouterI18n({
    resolveLocale: localeFromRequest,
    catalogDelivery: { development: true },
    ...options,
  });
  const errors: unknown[] = [];

  function documentShell(lang: string | undefined, ...children: ReactNode[]) {
    return createElement(
      "html",
      { lang },
      createElement("head"),
      createElement("body", null, ...children),
    );
  }

  function Root() {
    const data = useLoaderData() as { loader: string; locale: string };
    const content = [
      createElement("p", { id: "loader", key: "loader" }, data.loader),
      createElement("p", { id: "render", key: "render" }, getI18n()._("render")),
    ];
    return layout ? content : documentShell(data.locale, ...content);
  }

  function Layout({ children }: { children: ReactNode }) {
    const loaderData = useRouteLoaderData("root") as { locale: string } | undefined;
    const documentLocale = useDocumentLocale();
    const lang = layout === "document" ? (documentLocale ?? "en") : (loaderData?.locale ?? "en");
    // Translated layout chrome, like a `<Trans>` footer.
    const footer = layout === "document" ? getI18n()._("footer") : "Footer";
    return documentShell(lang, children, createElement("footer", { key: "footer" }, footer));
  }

  function ErrorBoundary() {
    const alert = createElement("main", { role: "alert", key: "alert" }, "Unavailable");
    return layout ? alert : documentShell(undefined, alert);
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
          ...(layout ? { Layout } : {}),
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
  return { handler: (request, context) => handle(request, context), errors, i18n };
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

  it("gives a 404 document the request locale for both lang and the import map", async () => {
    const clientDirectory = await createClientBuild();
    const app = createTestApp(
      { catalogDelivery: { clientDirectory, development: false } },
      undefined,
      "document",
    );

    // No root loader runs for an unknown path, so `lang` cannot come from
    // loader data. The browser bootstrap rejects a `lang` that differs from
    // the compiled catalog locale of the import map.
    const response = await app.handler(new Request("https://example.test/missing?locale=de"));
    const html = await response.text();

    expect(response.status).toBe(404);
    expect(html).toContain('<html lang="de">');
    expect(html).toContain('{"imports":{"#pmds/root":"/assets/root.de.js"}}');
    expect(html).toContain('<main role="alert">Unavailable</main>');
    expect(html).toContain("<footer>de[UTC]:footer</footer>");
    // React Router reports only the 404 itself.
    expect(app.errors).toEqual([expect.objectContaining({ status: 404 })]);
  });

  it("corrects lang for a layout that falls back to a default locale", async () => {
    const clientDirectory = await createClientBuild();
    const app = createTestApp(
      { catalogDelivery: { clientDirectory, development: false } },
      undefined,
      "fallback",
    );

    const html = await (
      await app.handler(new Request("https://example.test/missing?locale=de"))
    ).text();

    expect(html).toContain('<html lang="de">');
    expect(html).not.toContain('lang="en"');
    expect(html).toContain('{"imports":{"#pmds/root":"/assets/root.de.js"}}');
  });

  it("renders a server catalog failure with the request locale's browser catalogs", async () => {
    const clientDirectory = await createClientBuild();
    // The error document has no request scope, so its Layout uses no messages.
    const app = createTestApp(
      { catalogDelivery: { clientDirectory, development: false } },
      undefined,
      "fallback",
    );

    const response = await app.handler(new Request("https://example.test/?locale=fr"));
    const html = await response.text();

    expect(response.status).toBe(500);
    expect(html).toContain('<html lang="fr">');
    expect(html).toContain('{"imports":{"#pmds/root":"/assets/root.fr.js"}}');
    expect(html).toContain('<main role="alert">Unavailable</main>');
  });

  it("renders the error boundary without catalogs when the locale has no client build", async () => {
    const clientDirectory = await createClientBuild();
    const app = createTestApp(
      { catalogDelivery: { clientDirectory, development: false } },
      undefined,
      "document",
    );

    const response = await app.handler(new Request("https://example.test/?locale=es"));
    const html = await response.text();

    expect(response.status).toBe(500);
    expect(html).toContain('<main role="alert">Unavailable</main>');
    expect(html).toContain('<html lang="es">');
    expect(html).not.toContain("importmap");
    expect(html).not.toContain("Unexpected Server Error");
    expect(app.errors).toHaveLength(1);
    const error = app.errors[0] as Error;
    expect(error.message).toBe(
      "Palamedes React Router i18n initialization failed before the route handlers ran.",
    );
    expect((error.cause as Error).message).toContain('no generated import map for locale "es"');
  });

  it("delivers production catalogs from a production build without NODE_ENV", async () => {
    const clientDirectory = await createClientBuild();
    // Vite replaces `import.meta.env.DEV` in the server build; a custom
    // server may start that build without NODE_ENV.
    vi.stubEnv("DEV", false);
    vi.stubEnv("NODE_ENV", undefined);
    const app = createTestApp({ catalogDelivery: { clientDirectory } });

    const html = await (await app.handler(new Request("https://example.test/?locale=de"))).text();

    expect(html).toContain('{"imports":{"#pmds/root":"/assets/root.de.js"}}');
  });

  it("keeps development delivery for a development build under NODE_ENV=production", async () => {
    vi.stubEnv("DEV", true);
    vi.stubEnv("NODE_ENV", "production");
    // A development build reads no manifest, so a missing client build is fine.
    const app = createTestApp({ catalogDelivery: { clientDirectory: "/missing/client" } });

    const html = await (await app.handler(new Request("https://example.test/?locale=de"))).text();

    expect(html).toContain("palamedes:catalogError");
    expect(html).not.toContain("importmap");
  });

  it("resolves the nonce once per document from the request's load context", async () => {
    const clientDirectory = await createClientBuild();
    const nonceKey = createContext<string>();
    const nonce = vi.fn((_request: Request, context: ReactRouterContext) => context.get(nonceKey));
    const app = createTestApp({ catalogDelivery: { clientDirectory, development: false }, nonce });
    const loadContext = new RouterContextProvider();
    loadContext.set(nonceKey, "nonce-from-context");

    const html = await (
      await app.handler(new Request("https://example.test/?locale=de"), loadContext)
    ).text();

    expect(nonce).toHaveBeenCalledTimes(1);
    expect(nonce).toHaveBeenCalledWith(expect.any(Request), loadContext);
    expect(html).toContain('<script type="importmap" nonce="nonce-from-context">');
    // React Router's own inline scripts carry the same value.
    expect(html.match(/<script nonce="nonce-from-context"/gu)?.length).toBeGreaterThan(0);
    expect(html).not.toMatch(/<script(?![^>]*nonce="nonce-from-context")[^>]*>/u);
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

  it("reads the document locale from <html lang> in the browser", () => {
    function Probe() {
      return createElement("p", null, useDocumentLocale() ?? "none");
    }

    expect(renderToStaticMarkup(createElement(Probe))).toBe("<p>none</p>");
    vi.stubGlobal("document", { documentElement: { lang: "de" } });
    expect(renderToStaticMarkup(createElement(Probe))).toBe("<p>de</p>");
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
      // `es` has a server catalog but no client build, `fr` the reverse.
      locales: ["en", "de", "fr"],
      importMaps: {
        en: "palamedes-importmap.en.json",
        de: "palamedes-importmap.de.json",
        fr: "palamedes-importmap.fr.json",
      },
      chunkImports: {},
    }),
  );
  for (const locale of ["en", "de", "fr"]) {
    await writeFile(
      path.join(clientDirectory, `palamedes-importmap.${locale}.json`),
      JSON.stringify({ imports: { "#pmds/root": `/assets/root.${locale}.js` } }),
    );
  }
  return clientDirectory;
}
