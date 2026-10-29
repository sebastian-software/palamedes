import { afterEach, describe, expect, it, vi } from "vitest";
import { getI18n, resetI18nRuntime } from "@palamedes/runtime";
import type { I18nInstance } from "@palamedes/runtime";
import { createScopedI18nRunner } from "@palamedes/runtime/server";
import type * as RuntimeServer from "@palamedes/runtime/server";

import {
  createTanStackI18nRequestMiddleware,
  createTanStackServerI18nRequestMiddleware,
} from "./index";

function unusedRenderMessage(): never {
  throw new Error("renderMessage is not used by request-scope tests.");
}

const serverModule = vi.hoisted(() => ({
  delivered: [] as Array<{ locale: string; url: string; context?: object }>,
}));

vi.mock("@palamedes/runtime/server", async (importOriginal) => {
  const actual = await importOriginal<typeof RuntimeServer>();
  return { ...actual, createScopedI18nRunner: vi.fn(actual.createScopedI18nRunner) };
});

// The real server entry imports the Vite-generated catalog module. These tests
// cover the request middleware, so they replace catalog loading and delivery.
vi.mock("./server", () => ({
  createTanStackServerI18n: vi.fn(async (options: { locale: string; timeZone?: string }) => ({
    locale: options.locale,
    timeZone: options.timeZone,
    _: (message: string) => `${options.locale}:${message}`,
  })),
  createTanStackCatalogResponseDelivery: vi.fn(
    () => async (result: unknown, locale: string, request: Request, context?: object) => {
      serverModule.delivered.push({ locale, url: request.url, context });
      return result;
    },
  ),
}));

type RequestHandler = (options: {
  context?: object;
  handlerType: "router" | "serverFn";
  next: () => Promise<unknown>;
  request: Request;
}) => Promise<unknown>;

function handler(middleware: unknown): RequestHandler {
  return (middleware as { options: { server: RequestHandler } }).options.server;
}

describe("React Start host binding", () => {
  afterEach(() => {
    resetI18nRuntime();
    vi.clearAllMocks();
  });

  it("activates the original server-function request and leaves router requests alone", async () => {
    const resolveI18n = vi.fn((incomingRequest: Request) => ({
      locale: incomingRequest.headers.get("x-locale") ?? "en",
      _: (message: string) => message,
      load() {},
      activate() {},
      renderMessage: unusedRenderMessage,
    }));
    const run = handler(createTanStackI18nRequestMiddleware(resolveI18n));
    const request = new Request("https://example.test/_serverFn/probe", {
      headers: { "x-locale": "de" },
    });
    const result = new Response("ok");
    expect(await run({ handlerType: "router", request, next: async () => result })).toBe(result);
    expect(resolveI18n).not.toHaveBeenCalled();
    expect(
      await run({
        handlerType: "serverFn",
        request,
        async next() {
          expect(getI18n().locale).toBe("de");
          return result;
        },
      }),
    ).toBe(result);
    expect(resolveI18n).toHaveBeenCalledWith(request);
    expect(() => getI18n()).toThrow("No active server i18n instance");
  });

  it("isolates concurrent server-function requests through the real host middleware", async () => {
    const run = handler(
      createTanStackI18nRequestMiddleware((request): I18nInstance => {
        const locale = request.headers.get("x-locale")!;
        return {
          locale,
          _: (message: string) => `${locale}:${message}`,
          load() {},
          activate() {},
          renderMessage: unusedRenderMessage,
        };
      }),
    );
    await Promise.all(
      ["de", "en"].map(async (locale) => {
        const request = new Request("https://example.test/", { headers: { "x-locale": locale } });
        await run({
          handlerType: "serverFn",
          request,
          async next() {
            await new Promise((resolve) => setTimeout(resolve, locale === "de" ? 5 : 1));
            expect(getI18n()._("Hello")).toBe(`${locale}:Hello`);
            return new Response(locale);
          },
        });
      }),
    );
    expect(() => getI18n()).toThrow("No active server i18n instance");
  });

  it("preserves catalog errors and prevents dispatch before initialization", async () => {
    const failure = new Error("The generated de catalog is unavailable");
    const next = vi.fn(async () => new Response("must not run"));
    const run = handler(
      createTanStackI18nRequestMiddleware(() => {
        throw failure;
      }),
    );
    await expect(
      run({ handlerType: "serverFn", request: new Request("https://example.test/"), next }),
    ).rejects.toMatchObject({
      message: "Palamedes TanStack i18n initialization failed before server-function dispatch ran.",
      cause: failure,
    });
    expect(next).not.toHaveBeenCalled();
  });
});

describe("catalog-backed request middleware", () => {
  afterEach(() => {
    resetI18nRuntime();
    serverModule.delivered.length = 0;
    vi.clearAllMocks();
  });

  it("creates one server i18n scope per middleware instead of one per request", async () => {
    const run = handler(
      createTanStackServerI18nRequestMiddleware({
        resolveLocale: (request) => request.headers.get("x-locale")!,
      }),
    );
    expect(createScopedI18nRunner).toHaveBeenCalledTimes(1);

    for (let index = 0; index < 200; index += 1) {
      const locale = index % 2 === 0 ? "de" : "en";
      await run({
        handlerType: index % 3 === 0 ? "serverFn" : "router",
        request: new Request(`https://example.test/${index}`, { headers: { "x-locale": locale } }),
        async next() {
          expect(getI18n().locale).toBe(locale);
          return new Response(locale);
        },
      });
    }

    // Each scope owns an AsyncLocalStorage, so scopes are created once per
    // middleware instead of once per request.
    expect(createScopedI18nRunner).toHaveBeenCalledTimes(1);
  });

  it("keeps locale, options, and catalog delivery isolated across interleaved requests", async () => {
    const { createTanStackServerI18n } = await import("./server");
    const delays: Record<string, number> = { de: 8, en: 1, fr: 4 };
    const run = handler(
      createTanStackServerI18nRequestMiddleware({
        async resolveLocale(request) {
          const locale = request.headers.get("x-locale")!;
          await new Promise((resolve) => setTimeout(resolve, delays[locale]));
          return locale;
        },
        i18nOptions(request, locale) {
          expect(request.headers.get("x-locale")).toBe(locale);
          return { timeZone: request.headers.get("x-time-zone")! };
        },
      }),
    );
    const requests = ["de", "en", "fr", "en", "de"].map(
      (locale, index) =>
        new Request(`https://example.test/${locale}/${index}`, {
          headers: { "x-locale": locale, "x-time-zone": `Zone/${locale}` },
        }),
    );

    const results = await Promise.all(
      requests.map((request) =>
        run({
          handlerType: "router",
          request,
          async next() {
            const locale = request.headers.get("x-locale")!;
            await new Promise((resolve) => setTimeout(resolve, 10 - delays[locale]));
            expect(getI18n()._("Hello")).toBe(`${locale}:Hello`);
            return new Response(locale);
          },
        }),
      ),
    );

    expect(await Promise.all(results.map((result) => (result as Response).text()))).toEqual([
      "de",
      "en",
      "fr",
      "en",
      "de",
    ]);
    expect(serverModule.delivered).toHaveLength(requests.length);
    for (const { locale, url } of serverModule.delivered) {
      expect(new URL(url).pathname.split("/")[1]).toBe(locale);
    }
    for (const request of requests) {
      const locale = request.headers.get("x-locale")!;
      expect(createTanStackServerI18n).toHaveBeenCalledWith({ locale, timeZone: `Zone/${locale}` });
    }
    expect(createScopedI18nRunner).toHaveBeenCalledTimes(1);
    expect(() => getI18n()).toThrow("No active server i18n instance");
  });

  it("skips delivery for server functions and when catalog delivery is disabled", async () => {
    const { createTanStackCatalogResponseDelivery } = await import("./server");
    const request = new Request("https://example.test/", { headers: { "x-locale": "de" } });
    const resolveLocale = (incoming: Request) => incoming.headers.get("x-locale")!;

    await handler(createTanStackServerI18nRequestMiddleware({ resolveLocale }))({
      handlerType: "serverFn",
      request,
      next: async () => new Response("ok"),
    });
    await handler(
      createTanStackServerI18nRequestMiddleware({ resolveLocale, catalogDelivery: false }),
    )({ handlerType: "router", request, next: async () => new Response("ok") });

    expect(serverModule.delivered).toEqual([]);
    expect(createTanStackCatalogResponseDelivery).toHaveBeenCalledTimes(1);
  });

  it("propagates locale failures without dispatching the request", async () => {
    const failure = new Error("locale policy failed");
    const next = vi.fn(async () => new Response("must not run"));
    const run = handler(
      createTanStackServerI18nRequestMiddleware({
        resolveLocale() {
          throw failure;
        },
      }),
    );

    await expect(
      run({ handlerType: "router", request: new Request("https://example.test/"), next }),
    ).rejects.toMatchObject({
      message: "Palamedes TanStack i18n initialization failed before server-function dispatch ran.",
      cause: failure,
    });
    expect(next).not.toHaveBeenCalled();
  });

  it("uses a custom failureMessage and passes static i18nOptions", async () => {
    const { createTanStackServerI18n } = await import("./server");
    const failure = new Error("catalog failed");
    const failing = handler(
      createTanStackServerI18nRequestMiddleware({
        resolveLocale: () => "de",
        i18nOptions() {
          throw failure;
        },
        failureMessage: "Custom TanStack failure",
      }),
    );
    const request = new Request("https://example.test/");

    await expect(
      failing({ handlerType: "router", request, next: async () => new Response("ok") }),
    ).rejects.toMatchObject({ message: "Custom TanStack failure", cause: failure });

    await handler(
      createTanStackServerI18nRequestMiddleware({
        resolveLocale: () => "de",
        i18nOptions: { timeZone: "Europe/Berlin" },
      }),
    )({ handlerType: "serverFn", request, next: async () => new Response("ok") });
    expect(createTanStackServerI18n).toHaveBeenCalledWith({
      locale: "de",
      timeZone: "Europe/Berlin",
    });
  });

  it("hands the request middleware context to catalog delivery", async () => {
    const context = { nonce: "from-earlier-middleware" };

    await handler(createTanStackServerI18nRequestMiddleware({ resolveLocale: () => "de" }))({
      context,
      handlerType: "router",
      request: new Request("https://example.test/"),
      next: async () => new Response("ok"),
    });

    expect(serverModule.delivered).toEqual([
      { locale: "de", url: "https://example.test/", context },
    ]);
  });

  it("rejects the v1 positional arguments and resolveOptions with migration errors", () => {
    expect(() =>
      // @ts-expect-error JavaScript callers of the v1 positional form get the migration error.
      createTanStackServerI18nRequestMiddleware(() => "de"),
    ).toThrow(
      "Palamedes v2 changed createTanStackServerI18nRequestMiddleware() to take one options object: pass { resolveLocale, i18nOptions, catalogDelivery } instead of positional arguments. The former resolveOptions(request) argument is now i18nOptions(request, locale).",
    );
    expect(() =>
      createTanStackServerI18nRequestMiddleware({
        resolveLocale: () => "de",
        // @ts-expect-error JavaScript callers of the renamed option get the migration error.
        resolveOptions: () => ({}),
      }),
    ).toThrow(
      "Palamedes v2 renamed resolveOptions to i18nOptions: it receives (request, locale) and returns the createI18n options, as in the other adapters. Rename the option.",
    );
  });
});
