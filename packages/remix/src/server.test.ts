import { afterEach, describe, expect, it, vi } from "vitest";

import { defineCompiledCatalog } from "@palamedes/core/compiled";
import { defineLocaleControls } from "@palamedes/core/locale";
import { getI18n, resetI18nRuntime, type I18nInstance } from "@palamedes/runtime";
import { transformPalamedesMacros } from "@palamedes/transform";
import { createRouter } from "remix/router";

import { createPalamedesRemixCatalogAssetRegistry } from "./index";
import { createRemixI18nRequestScope, createRemixI18nServer } from "./server";

describe("stable Remix client entries", () => {
  const locales = defineLocaleControls({ locales: ["en", "de"], defaultLocale: "en" });

  it("rejects the retired URL override instead of emitting a bootstrap outside its import-map scope", () => {
    expect(() =>
      createRemixI18nServer({
        locales,
        strategy: "cookie",
        loadMessages: () => defineCompiledCatalog({}),
        catalogAssets: {
          // @ts-expect-error Legacy JavaScript callers receive the migration diagnostic too.
          clientModuleUrl: "/custom/client.mjs",
        },
      }),
    ).toThrow(
      "Remove catalogAssets.clientModuleUrl. Pass the actual assetServer to renderClientEntry()",
    );
  });

  it("includes both application and bootstrap dependencies in an escaped, nonce-bearing import map", async () => {
    const remixI18n = createRemixI18nServer({
      locales,
      strategy: "cookie",
      loadMessages: () => defineCompiledCatalog({}),
    });
    const importMap = {
      imports: { "@palamedes/runtime": "/assets/runtime.js" },
      scopes: { "/assets/": { example: "</script><script>alert(1)</script>" } },
    };
    const assetServer = {
      getHref: vi.fn(async (file: string) =>
        file === "app/public/client.tsx"
          ? "/assets/app/client.hash.js"
          : "/assets/remix/client.hash.js",
      ),
      getImportMap: vi.fn(async () => importMap),
    };
    const html = await remixI18n.renderClientEntry("app/public/client.tsx", {
      assetServer,
      nonce: 'request"nonce',
      errorHtml: "<p>Reload</p>",
    });
    expect(assetServer.getImportMap).toHaveBeenCalledWith([
      "app/public/client.tsx",
      expect.stringContaining(path.join("remix", "dist", "client.mjs")),
    ]);
    const mapSource = html.match(/<script type="importmap"[^>]*>(.*?)<\/script>/u)?.[1];
    const entryUrl = html.match(/src="([^"]+)"/u)?.[1];
    expect(JSON.parse(mapSource!)).toEqual({
      ...importMap,
      scopes: {
        ...importMap.scopes,
        [entryUrl!]: {
          "@palamedes/remix/client": "/assets/remix/client.hash.js",
          "@palamedes/remix/entry-data": encodeEntryData({
            entry: "/assets/app/client.hash.js",
            errorHtml: "<p>Reload</p>",
          }),
        },
      },
    });
    expect(mapSource).not.toContain("</script>");
    expect(html.match(/nonce="request&quot;nonce"/gu)).toHaveLength(2);
    expect(html).not.toContain("data-palamedes-entry");
    expect(html).not.toContain("data-palamedes-error-html");
    const response = remixI18n.serveClientCatalogAsset(
      new Request(`https://example.test${entryUrl}`),
    );
    expect(response?.status).toBe(200);
    const source = await response?.text();
    expect(source).toContain('from "@palamedes/remix/client"');
    expect(source).toContain('import.meta.resolve("@palamedes/remix/entry-data")');
    expect(source).not.toContain("querySelector");
    expect(source).not.toContain("dataset");
  });

  it("serves identical bootstrap bytes from cold workers and restarted adapters", async () => {
    const createWorker = () =>
      createRemixI18nServer({
        locales,
        strategy: "cookie",
        loadMessages: () => defineCompiledCatalog({}),
        catalogAssets: { basePath: "/custom/assets/" },
      });
    const first = createWorker();
    const cold = createWorker();
    const assetServer = {
      getHref: async (file: string) =>
        `/custom/assets/${file.endsWith(".tsx") ? "app" : "client"}.js`,
      getImportMap: async () => ({ imports: {}, scopes: {} }),
    };
    const html = await first.renderClientEntry("app/public/client.tsx", { assetServer });
    const src = html.match(/src="([^"]+)"/u)![1];
    expect(src).toMatch(/^\/custom\/assets\/__palamedes\/entry\/[a-f0-9]{64}\.js$/u);
    const request = new Request(`https://example.test${src}`);
    const expected = await first.serveClientCatalogAsset(request)!.text();
    for (const worker of [cold, createWorker()]) {
      const response = worker.serveClientCatalogAsset(request)!;
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("application/javascript; charset=utf-8");
      expect(await response.text()).toBe(expected);
    }
    // Any worker renders the same scoped entry data for the same build.
    expect(await cold.renderClientEntry("app/public/client.tsx", { assetServer })).toBe(html);
    expect(
      cold.serveClientCatalogAsset(
        new Request("https://example.test/custom/assets/__palamedes/entry/not-an-entry.js"),
      )?.status,
    ).toBe(404);
  });

  it("keeps distinct entries isolated and escapes their URL and error markup", async () => {
    const worker = createRemixI18nServer({
      locales,
      strategy: "cookie",
      loadMessages: () => defineCompiledCatalog({}),
    });
    const entryUrl = '/assets/app.js?value="<&';
    const errorHtml = '<p title="retry & reload">Failure</p></script>\r\n\u2028%';
    const options = {
      assetServer: {
        getHref: async (file: string) => (file.endsWith(".tsx") ? entryUrl : "/assets/client.js"),
        getImportMap: async () => ({ imports: {}, scopes: {} }),
      },
      errorHtml,
    };
    const html = await worker.renderClientEntry("app/public/client.tsx", options);
    expect(html.match(/<script /gu)).toHaveLength(2);
    expect(html).not.toContain("Failure</p>");
    const src = html.match(/src="([^"]+)"/u)![1];
    const entryData = parseEntryScope(html, src)["@palamedes/remix/entry-data"]!;
    expect(decodeEntryData(entryData)).toEqual({ entry: entryUrl, errorHtml });
    // Browsers normalize import-map addresses with the URL parser; the encoded
    // data must survive that normalization unchanged.
    expect(new URL(entryData).href).toBe(entryData);
    const otherHtml = await worker.renderClientEntry("app/public/client.tsx", {
      ...options,
      errorHtml: "Other entry",
    });
    expect(otherHtml.match(/src="([^"]+)"/u)![1]).not.toBe(src);
    const source = await worker
      .serveClientCatalogAsset(new Request(`https://example.test${src}`))!
      .text();
    expect(source).not.toContain(entryUrl);
    expect(source).not.toContain(errorHtml);
  });

  describe("bootstrap execution", () => {
    const ownEntry = 'data:text/javascript,export default "own entry"';
    const forgedEntry = "data:text/javascript,export default 'forged entry'";
    const forgedErrorHtml = '<img src="x" onerror="alert(1)">';

    const renderAndRun = async (
      errorHtml: string | undefined,
      resolveEntryData: (scopedEntryData: string) => string | null,
    ) => {
      const worker = createRemixI18nServer({
        locales,
        strategy: "cookie",
        loadMessages: () => defineCompiledCatalog({}),
      });
      const html = await worker.renderClientEntry("app/public/client.tsx", {
        assetServer: {
          getHref: async (file: string) => (file.endsWith(".tsx") ? ownEntry : "/assets/client.js"),
          getImportMap: async () => ({ imports: {}, scopes: {} }),
        },
        ...(errorHtml === undefined ? {} : { errorHtml }),
      });
      const src = html.match(/src="([^"]+)"/u)![1];
      const scopedEntryData = parseEntryScope(html, src)["@palamedes/remix/entry-data"]!;
      const source = await worker
        .serveClientCatalogAsset(new Request(`https://example.test${src}`))!
        .text();
      // Node has no import maps: route both scoped specifiers through test doubles
      // that model the import-map scope this document rendered for the bootstrap.
      const client = `data:text/javascript,${encodeURIComponent("export const startRemixClient = (...args) => globalThis.startTestRemixClient(...args);")}`;
      const testSource = source
        .replace('"@palamedes/remix/client"', JSON.stringify(client))
        .replace("import.meta.resolve(", "globalThis.resolveTestSpecifier(");
      const moduleUrl = `data:text/javascript,${encodeURIComponent(`${testSource}\n// ${crypto.randomUUID()}`)}`;
      const calls: Array<{ entry: unknown; errorHtml: string | undefined }> = [];
      vi.stubGlobal(
        "startTestRemixClient",
        async (loadEntry: () => Promise<{ default: unknown }>, options: { errorHtml?: string }) => {
          try {
            calls.push({ entry: (await loadEntry()).default, errorHtml: options.errorHtml });
          } catch (error) {
            calls.push({ entry: error, errorHtml: options.errorHtml });
          }
        },
      );
      vi.stubGlobal("resolveTestSpecifier", (specifier: string) => {
        expect(specifier).toBe("@palamedes/remix/entry-data");
        const resolved = resolveEntryData(scopedEntryData);
        if (resolved === null) throw new TypeError(`Unmapped specifier ${specifier}`);
        return resolved;
      });
      // Injected, non-executing markup precedes the real script and claims its
      // URL. The bootstrap must not consult the document for its data at all.
      const forgedScripts = [
        { src: moduleUrl, dataset: { palamedesEntry: forgedEntry } },
        {
          src: moduleUrl,
          dataset: { palamedesEntry: forgedEntry, palamedesErrorHtml: forgedErrorHtml },
        },
        { src: moduleUrl, dataset: { palamedesEntry: ownEntry } },
      ];
      const documentLookup = vi.fn(() => forgedScripts);
      vi.stubGlobal("document", {
        querySelector: documentLookup,
        querySelectorAll: documentLookup,
        getElementsByTagName: documentLookup,
        get scripts() {
          return documentLookup();
        },
        get currentScript() {
          return documentLookup()[0];
        },
      });
      try {
        await import(/* @vite-ignore */ moduleUrl);
      } finally {
        vi.unstubAllGlobals();
      }
      expect(documentLookup).not.toHaveBeenCalled();
      expect(calls).toHaveLength(1);
      return calls[0]!;
    };

    it("loads the entry and error markup scoped to its own URL, ignoring forged siblings", async () => {
      await expect(
        renderAndRun('<p title="retry & reload">Failure</p>', (data) => data),
      ).resolves.toEqual({
        entry: "own entry",
        errorHtml: '<p title="retry & reload">Failure</p>',
      });
    });

    it("keeps the default error markup when forged siblings carry error markup", async () => {
      await expect(renderAndRun(undefined, (data) => data)).resolves.toEqual({
        entry: "own entry",
        errorHtml: undefined,
      });
    });

    it.each([
      ["is not mapped", () => null],
      ["resolves outside its scope", () => "https://evil.test/@palamedes/remix/entry-data"],
      ["is malformed", () => "data:application/json,%7Bnot-json"],
      ["has no entry", () => `data:application/json,${encodeURIComponent('{"errorHtml":"x"}')}`],
    ])(
      "fails visibly through the default error path when entry data %s",
      async (_label, resolveEntryData) => {
        const call = await renderAndRun("<p>Configured</p>", resolveEntryData);
        expect(call.errorHtml).toBeUndefined();
        expect(call.entry).toBeInstanceOf(Error);
        expect((call.entry as Error).message).toBe(
          "Palamedes Remix application entry data is missing from the import map.",
        );
      },
    );
  });

  it("propagates asset graph compilation failures before rendering an entry", async () => {
    const remixI18n = createRemixI18nServer({
      locales,
      strategy: "cookie",
      loadMessages: () => defineCompiledCatalog({}),
    });
    const failure = new Error("Invalid catalog in client entry graph");
    await expect(
      remixI18n.renderClientEntry("app/public/client.tsx", {
        assetServer: {
          getHref: async () => "/assets/client.js",
          async getImportMap() {
            throw failure;
          },
        },
      }),
    ).rejects.toBe(failure);
  });
});

function createTestI18n(locale: string): I18nInstance {
  return {
    locale,
    _: (id: string) => `${locale}:${id}`,
    load() {},
    activate() {},
    renderMessage: unusedRenderMessage,
  };
}

describe("createRemixI18nRequestScope", () => {
  afterEach(() => {
    resetI18nRuntime();
  });

  it("runs request handlers with the resolved server i18n instance", async () => {
    const remixI18n = createRemixI18nRequestScope((request) => {
      const locale = request.headers.get("accept-language")?.startsWith("de") ? "de" : "en";
      return createTestI18n(locale);
    });

    const response = await remixI18n.run(
      new Request("https://example.test/", {
        headers: { "accept-language": "de" },
      }),
      (i18n) => {
        expect(remixI18n.get()).toBe(i18n);
        expect(getI18n()).toBe(i18n);
        return new Response(getI18n()._("checkout.title"), {
          headers: { "x-locale": i18n.locale },
        });
      },
    );

    expect(response.headers.get("x-locale")).toBe("de");
    expect(await response.text()).toBe("de:checkout.title");
    expect(remixI18n.get()).toBeUndefined();
  });

  it("keeps concurrent requests isolated", async () => {
    const remixI18n = createRemixI18nRequestScope(async (request) =>
      createTestI18n(request.headers.get("x-locale") ?? "en"),
    );

    await Promise.all([
      remixI18n.run(
        new Request("https://example.test/", { headers: { "x-locale": "de" } }),
        async (i18n) => {
          await Promise.resolve();
          expect(getI18n()).toBe(i18n);
          expect(getI18n().locale).toBe("de");
        },
      ),
      remixI18n.run(
        new Request("https://example.test/", { headers: { "x-locale": "en" } }),
        async (i18n) => {
          await Promise.resolve();
          expect(getI18n()).toBe(i18n);
          expect(getI18n().locale).toBe("en");
        },
      ),
    ]);
  });

  it("uses a custom failureMessage for resolver failures", async () => {
    const failure = new Error("catalog is unavailable");
    const remixI18n = createRemixI18nRequestScope(
      async () => {
        throw failure;
      },
      { failureMessage: "Custom request scope failure" },
    );

    await expect(
      remixI18n.run(new Request("https://example.test/"), () => {}),
    ).rejects.toMatchObject({ message: "Custom request scope failure", cause: failure });
  });

  it("wraps resolver failures without entering the request callback", async () => {
    const failure = new Error("catalog is unavailable");
    const remixI18n = createRemixI18nRequestScope(async () => {
      throw failure;
    });

    await expect(
      remixI18n.run(new Request("https://example.test/"), () => {
        throw new Error("callback must not run");
      }),
    ).rejects.toMatchObject({
      message: "Palamedes Remix i18n initialization failed before the handler ran.",
      cause: failure,
    });
  });

  it("keeps request scope active while a returned response body is streamed", async () => {
    const remixI18n = createRemixI18nRequestScope(() => createTestI18n("de"));
    const encoder = new TextEncoder();
    let sent = false;

    const response = await remixI18n.run(
      new Request("https://example.test/"),
      () =>
        new Response(
          new ReadableStream({
            pull(controller) {
              if (sent) {
                controller.close();
                return;
              }

              sent = true;
              controller.enqueue(encoder.encode(getI18n()._("streamed.title")));
            },
          }),
        ),
    );

    expect(remixI18n.get()).toBeUndefined();
    expect(await response.text()).toBe("de:streamed.title");
  });

  it("preserves fetch metadata while binding a returned response body", async () => {
    const remixI18n = createRemixI18nRequestScope(() => createTestI18n("en"));
    const fetched = await fetch("data:text/plain,translated");
    Object.defineProperty(fetched, "redirected", { value: true });

    const response = await remixI18n.run(new Request("https://example.test/"), () => fetched);
    const cloned = response.clone();

    expect({
      redirected: response.redirected,
      type: response.type,
      url: response.url,
    }).toStrictEqual({
      redirected: true,
      type: "basic",
      url: "data:text/plain,translated",
    });
    expect({
      redirected: cloned.redirected,
      type: cloned.type,
      url: cloned.url,
    }).toStrictEqual({
      redirected: true,
      type: "basic",
      url: "data:text/plain,translated",
    });
    expect(await response.text()).toBe("translated");
    expect(await cloned.text()).toBe("translated");
  });
});

describe("createRemixI18nServer", () => {
  afterEach(() => {
    resetI18nRuntime();
  });

  const locales = defineLocaleControls({
    locales: ["en", "de", "es"],
    defaultLocale: "en",
    cookies: { locale: "locale" },
  });

  it("rejects the removed catalogVersion callback with a migration error", () => {
    expect(() =>
      createRemixI18nServer({
        locales,
        strategy: "cookie",
        loadMessages: () => defineCompiledCatalog({}),
        // @ts-expect-error JavaScript callers of the removed callback form get the migration error.
        catalogVersion: ({ messages }: { messages: object }) => JSON.stringify(messages),
      }),
    ).toThrow(
      "Palamedes v2 removed the catalogVersion callback: catalog versions derive from the executable catalog asset. Pass a deployment version string, or omit catalogVersion to use the content digest.",
    );
  });

  it("rejects the renamed createI18n factory option with a migration error", () => {
    expect(() =>
      createRemixI18nServer({
        locales,
        strategy: "cookie",
        loadMessages: () => defineCompiledCatalog({}),
        // @ts-expect-error JavaScript callers of the renamed option get the migration error.
        createI18n: () => ({}),
      }),
    ).toThrow(
      "Palamedes v2 renamed the Remix createI18n option to i18nOptions: return the createI18n options for the request, such as { timeZone }, instead of an instance. Rename the option; the adapter creates the instance.",
    );
  });

  it("no longer offers the synchronous createI18n(locale) method", () => {
    const remixI18n = createRemixI18nServer({
      locales,
      strategy: "cookie",
      loadMessages: () => defineCompiledCatalog({}),
    });

    expect(remixI18n).not.toHaveProperty("createI18n");
  });

  it("creates each request instance with i18nOptions for its request and locale", async () => {
    const i18nOptions = vi.fn(async (incoming: Request, locale: "en" | "de" | "es") => ({
      timeZone: incoming.headers.get("x-time-zone") ?? (locale === "de" ? "Europe/Berlin" : "UTC"),
    }));
    const remixI18n = createRemixI18nServer({
      locales,
      strategy: "cookie",
      loadMessages: (locale) => defineCompiledCatalog({ greeting: `hello:${locale}` }),
      i18nOptions,
    });
    const request = new Request("https://example.test/", {
      headers: { cookie: "locale=de", "x-time-zone": "Asia/Tokyo" },
    });

    await remixI18n.run(request, ({ i18n, locale }) => {
      expect(locale).toBe("de");
      expect(i18n.locale).toBe("de");
      expect(i18n.timeZone).toBe("Asia/Tokyo");
      expect(i18n._("greeting")).toBe("hello:de");
    });

    expect(i18nOptions).toHaveBeenCalledWith(request, "de");
  });

  it("accepts static i18nOptions", async () => {
    const remixI18n = createRemixI18nServer({
      locales,
      strategy: "cookie",
      loadMessages: () => defineCompiledCatalog({}),
      i18nOptions: { timeZone: "Europe/Berlin" },
    });

    await expect(
      remixI18n.run(new Request("https://example.test/"), ({ i18n }) => i18n.timeZone),
    ).resolves.toBe("Europe/Berlin");
  });

  it("wraps initialization failures in failureMessage without entering the callback", async () => {
    const failure = new Error("catalog is unavailable");
    const callback = vi.fn();
    const defaultMessage = createRemixI18nServer({
      locales,
      strategy: "cookie",
      loadMessages() {
        throw failure;
      },
    });
    const customMessage = createRemixI18nServer({
      locales,
      strategy: "cookie",
      loadMessages: () => defineCompiledCatalog({}),
      i18nOptions() {
        throw failure;
      },
      failureMessage: "Custom Remix failure",
    });

    await expect(
      defaultMessage.run(new Request("https://example.test/"), callback),
    ).rejects.toMatchObject({
      message: "Palamedes Remix i18n initialization failed before the handler ran.",
      cause: failure,
    });
    await expect(
      customMessage.run(new Request("https://example.test/"), callback),
    ).rejects.toMatchObject({ message: "Custom Remix failure", cause: failure });
    expect(callback).not.toHaveBeenCalled();
  });

  it("resolves request locale and caches catalog messages by locale", async () => {
    const loadMessages = vi.fn((locale: "en" | "de" | "es") =>
      defineCompiledCatalog({
        greeting: `${locale}:Hallo`,
      }),
    );
    const remixI18n = createRemixI18nServer({
      locales,
      strategy: "cookie",
      loadMessages,
    });

    await remixI18n.run(
      new Request("https://example.test/", {
        headers: { "accept-language": "de" },
      }),
      ({ i18n, locale }) => {
        expect(locale).toBe("de");
        expect(getI18n()).toBe(i18n);
        expect(remixI18n.get()).toStrictEqual({
          i18n,
          locale: "de",
          source: "accept-language",
        });
        expect(i18n._("greeting")).toBe("de:Hallo");
      },
    );

    await remixI18n.run(
      new Request("https://example.test/", {
        headers: { "accept-language": "de" },
      }),
      ({ i18n }) => {
        expect(i18n._("greeting")).toBe("de:Hallo");
      },
    );

    expect(loadMessages).toHaveBeenCalledTimes(1);
  });

  it("loads a registry catalog asynchronously once for concurrent requests", async () => {
    const load = vi.fn(async (locale: string) =>
      defineCompiledCatalog({ greeting: `registry:${locale}` }),
    );
    const remixI18n = createRemixI18nServer({
      locales,
      strategy: "cookie",
      catalogAssets: {
        registry: {
          load,
          register: () => "test",
          sidecarUrl: () => "/test.js",
          serve() {},
          invalidate() {},
        },
      },
    });

    const responses = await Promise.all(
      ["de", "de"].map((locale) =>
        remixI18n.run(
          new Request("https://example.test/", { headers: { cookie: `locale=${locale}` } }),
          ({ i18n }) => i18n._("greeting"),
        ),
      ),
    );

    expect(responses).toStrictEqual(["registry:de", "registry:de"]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("reloads the shared server catalog after a catalog generation changes", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "palamedes-remix-server-generation-"));
    const localesRoot = path.join(root, "locales");
    mkdirSync(localesRoot, { recursive: true });
    mkdirSync(path.join(root, "app"), { recursive: true });
    writeFileSync(
      path.join(root, "app", "route.tsx"),
      'import { t } from "@palamedes/core/macro"; export function route() { return t`Greeting`; }\n',
    );
    const greetingId = transformPalamedesMacros(
      'import { t } from "@palamedes/core/macro"; export function route() { return t`Greeting`; }\n',
      path.join(root, "app", "route.tsx"),
    ).compiledIds[0];
    writeFileSync(
      path.join(root, "palamedes.yaml"),
      [
        "locales: [en, de, es]",
        "source-locale: en",
        "catalogs:",
        "  - path: locales/{locale}",
        "    include: [app/**/*.tsx]",
      ].join("\n"),
    );
    for (const [locale, message] of [
      ["en", "Hello"],
      ["de", "Hallo"],
      ["es", "Hola"],
    ]) {
      writeFileSync(
        path.join(localesRoot, `${locale}.po`),
        `msgid ""\nmsgstr ""\n\nmsgid "Greeting"\nmsgstr "${message}"\n`,
      );
    }
    try {
      const registry = createPalamedesRemixCatalogAssetRegistry({ projectRoot: root });
      const remixI18n = createRemixI18nServer({
        locales,
        strategy: "cookie",
        catalogAssets: { registry },
      });
      const request = new Request("https://example.test/", {
        headers: { cookie: "locale=de" },
      });
      await expect(remixI18n.run(request, ({ i18n }) => i18n._(greetingId))).resolves.toBe("Hallo");
      writeFileSync(
        path.join(localesRoot, "de.po"),
        'msgid ""\nmsgstr ""\n\nmsgid "Greeting"\nmsgstr "Guten Tag"\n',
      );
      registry.invalidate();
      await expect(remixI18n.run(request, ({ i18n }) => i18n._(greetingId))).resolves.toBe(
        "Guten Tag",
      );
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("returns the scoped context source without a router context", async () => {
    const remixI18n = createRemixI18nServer({
      locales,
      strategy: "cookie",
      loadMessages: (locale) => defineCompiledCatalog({ greeting: `hello:${locale}` }),
    });

    await remixI18n.run(
      new Request("https://example.test/", {
        headers: { cookie: "locale=es", "accept-language": "de" },
      }),
      ({ i18n }) => {
        expect(remixI18n.get()).toStrictEqual({
          i18n,
          locale: "es",
          source: "cookie",
        });
      },
    );

    expect(remixI18n.get()).toBeUndefined();
  });

  it("wraps Remix router handlers with middleware request scope", async () => {
    const remixI18n = createRemixI18nServer({
      locales,
      strategy: "cookie",
      loadMessages: (locale) => defineCompiledCatalog({ greeting: `hello:${locale}` }),
    });
    const router = createRouter({ middleware: [remixI18n.middleware()] });

    router.get("/", (context) => {
      const palamedes = remixI18n.get(context);
      return new Response(`${palamedes?.locale}:${getI18n()._("greeting")}`);
    });

    const response = await router.fetch(
      new Request("https://example.test/", {
        headers: { cookie: "locale=es", "accept-language": "de" },
      }),
    );

    expect(await response.text()).toBe("es:hello:es");
  });

  it("serves only the requested locale as an executable catalog module", () => {
    const root = mkdtempSync(path.join(tmpdir(), "palamedes-remix-catalog-"));
    const localePath = path.join(root, "de.po");
    writeFileSync(
      path.join(root, "en.po"),
      'msgid ""\nmsgstr ""\n\nmsgid "greeting"\nmsgstr "Hello"\n',
    );
    writeFileSync(localePath, 'msgid ""\nmsgstr ""\n\nmsgid "greeting"\nmsgstr "Hallo"\n');
    try {
      const remixI18n = createRemixI18nServer({
        locales,
        strategy: "cookie",
        loadMessages: () => defineCompiledCatalog({ greeting: "Hallo" }),
        catalogAssets: {
          config: {
            rootDir: root,
            locales: ["en", "de", "es"],
            sourceLocale: "en",
            catalogs: [{ path: "{locale}", include: ["."] }],
          },
          resolvePath: () => localePath,
        },
      });

      const asset = remixI18n.createClientCatalogAsset("de");
      expect(asset.source).toContain("defineCompiledCatalog");
      expect(asset.source).toContain('export const locale="de"');
      expect(asset.source).not.toContain("msgid");
      expect(remixI18n.renderClientCatalog("de")).toContain("/assets/__palamedes/catalog/de.js");
      const response = remixI18n.serveClientCatalogAsset(
        new Request("https://example.test/assets/__palamedes/catalog/de.js"),
      );
      expect(response?.status).toBe(200);
      expect(response?.headers.get("content-type")).toContain("javascript");
      const cached = remixI18n.serveClientCatalogAsset(
        new Request("https://example.test/assets/__palamedes/catalog/de.js", {
          headers: { "if-none-match": response?.headers.get("etag") ?? "" },
        }),
      );
      expect(cached?.status).toBe(304);
      expect(
        remixI18n.serveClientCatalogAsset(
          new Request("https://example.test/assets/__palamedes/catalog/fr.js"),
        )?.status,
      ).toBe(404);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

function unusedRenderMessage(): never {
  throw new Error("renderMessage is not used by request-scope tests.");
}

const ENTRY_DATA_PREFIX = "data:application/json,";

function encodeEntryData(data: { entry: string; errorHtml: string | null }): string {
  return `${ENTRY_DATA_PREFIX}${encodeURIComponent(JSON.stringify(data))}`;
}

function decodeEntryData(value: string): unknown {
  expect(value.startsWith(ENTRY_DATA_PREFIX)).toBe(true);
  return JSON.parse(decodeURIComponent(value.slice(ENTRY_DATA_PREFIX.length)));
}

function parseEntryScope(html: string, src: string): Record<string, string> {
  const mapSource = html.match(/<script type="importmap"[^>]*>(.*?)<\/script>/u)![1]!;
  return (JSON.parse(mapSource) as { scopes: Record<string, Record<string, string>> }).scopes[src]!;
}
