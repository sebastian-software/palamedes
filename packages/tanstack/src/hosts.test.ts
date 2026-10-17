import { afterEach, describe, expect, it, vi } from "vitest";
import { getI18n, resetI18nRuntime } from "@palamedes/runtime";
import type { I18nInstance } from "@palamedes/runtime";

import { createTanStackI18nRequestMiddleware } from "./index";

type RequestHandler = (options: {
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
        return { locale, _: (message: string) => `${locale}:${message}` };
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
