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
    expect(JSON.parse(mapSource!)).toEqual(importMap);
    expect(mapSource).not.toContain("</script>");
    expect(html.match(/nonce="request&quot;nonce"/gu)).toHaveLength(2);
    const entryUrl = html.match(/src="([^"]+)"/u)?.[1];
    const response = remixI18n.serveClientCatalogAsset(
      new Request(`https://example.test${entryUrl}`),
    );
    expect(response?.status).toBe(200);
    const source = await response?.text();
    expect(source).toContain('from"/assets/remix/client.hash.js"');
    expect(source).toContain('import("/assets/app/client.hash.js")');
    expect(source).toContain('"errorHtml":"<p>Reload</p>"');
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

  it("rejects legacy message-version callbacks with executable registries", () => {
    expect(() =>
      createRemixI18nServer({
        locales,
        strategy: "cookie",
        catalogVersion: ({ messages }) => JSON.stringify(messages),
        catalogAssets: {
          registry: {
            load: async () => defineCompiledCatalog({}),
            register: () => "test",
            sidecarUrl: () => "/test",
            serve() {},
            invalidate() {},
          },
        },
      }),
    ).toThrow(/Remove the legacy messages callback/);
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
