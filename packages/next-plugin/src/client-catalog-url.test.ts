import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

const emitClientCatalogAssets = vi.hoisted(() => vi.fn(async () => ({ locales: {} })));
vi.mock("./client-catalog-assets", () => ({ emitClientCatalogAssets }));

import { CLIENT_CATALOG_BUILD_ENV } from "./client-catalog-map";
import { clientCatalogPublicPrefix, crossOriginClientCatalogHost } from "./client-catalog-url";
import { withPalamedes } from "./index";

const projectRoot = fileURLToPath(new URL("../../../examples/nextjs-route", import.meta.url));

afterEach(() => {
  vi.unstubAllEnvs();
  // withPalamedes() sets the build token on process.env for build workers.
  delete process.env[CLIENT_CATALOG_BUILD_ENV];
  vi.restoreAllMocks();
  emitClientCatalogAssets.mockClear();
});

describe("clientCatalogPublicPrefix", () => {
  it.each([
    [{}, ""],
    [{ basePath: "" }, ""],
    [{ basePath: "/shop" }, "/shop"],
    [{ assetPrefix: "/cdn" }, "/cdn"],
    [{ assetPrefix: "/cdn/" }, "/cdn"],
    [{ assetPrefix: "/" }, ""],
    // Next uses assetPrefix instead of basePath for /_next/ URLs, not both.
    [{ assetPrefix: "/cdn", basePath: "/shop" }, "/cdn"],
    [{ assetPrefix: "", basePath: "/shop" }, "/shop"],
    [{ assetPrefix: "https://cdn.example.com" }, "https://cdn.example.com"],
    [{ assetPrefix: "https://cdn.example.com/" }, "https://cdn.example.com"],
    [
      { assetPrefix: "https://cdn.example.com/app/", basePath: "/app" },
      "https://cdn.example.com/app",
    ],
    [{ assetPrefix: "//cdn.example.com/" }, "//cdn.example.com"],
  ])("maps %o to %s, like Next's own /_next/ prefix", (config, expected) => {
    expect(clientCatalogPublicPrefix(config)).toBe(expected);
  });
});

describe("crossOriginClientCatalogHost", () => {
  it.each([
    ["", undefined],
    ["/shop", undefined],
    ["/cdn", undefined],
    ["https://cdn.example.com", "https://cdn.example.com"],
    ["http://127.0.0.1:3203/app", "http://127.0.0.1:3203"],
    ["//cdn.example.com", "https://cdn.example.com"],
  ])("detects an absolute asset host in %s", (prefix, expected) => {
    expect(crossOriginClientCatalogHost(prefix)).toBe(expected);
  });
});

describe("withPalamedes client catalog asset URLs", () => {
  function production(config: Parameters<typeof withPalamedes>[0]) {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv(CLIENT_CATALOG_BUILD_ENV, undefined);
    const configured = withPalamedes(config, {
      projectRoot,
      experimentalClientCatalogAssets: true,
    });
    const hook = configured.compiler?.runAfterProductionCompile;
    expect(hook).toBeTypeOf("function");
    return { env: configured.env ?? {}, hook: hook! };
  }

  it("inlines Next's /_next/ prefix and passes the build token to the post-compile step", async () => {
    const userHook = vi.fn(async () => {});
    const { env, hook } = production({
      basePath: "/shop",
      assetPrefix: "/cdn/",
      env: { APP_FLAG: "1" },
      compiler: { runAfterProductionCompile: userHook },
    });
    await hook({ distDir: "/app/.next", projectDir: "/app" });

    expect(env).toMatchObject({
      APP_FLAG: "1",
      PALAMEDES_NEXT_CATALOG_BASE: "/cdn/_next/static/palamedes/",
      PALAMEDES_NEXT_CATALOG_BUILD: expect.stringMatching(/^[0-9a-f]{12}$/u),
    });
    expect(userHook).toHaveBeenCalledOnce();
    expect(emitClientCatalogAssets).toHaveBeenCalledWith(
      expect.objectContaining({
        distDir: "/app/.next",
        buildToken: env.PALAMEDES_NEXT_CATALOG_BUILD,
      }),
    );
  });

  it("keeps one build token across config evaluations of the same build", () => {
    const { env } = production({});
    // A build worker evaluates the config again with the inherited environment.
    const again = withPalamedes({}, { projectRoot, experimentalClientCatalogAssets: true });

    expect(again.env?.PALAMEDES_NEXT_CATALOG_BUILD).toBe(env.PALAMEDES_NEXT_CATALOG_BUILD);
    expect(production({}).env.PALAMEDES_NEXT_CATALOG_BUILD).not.toBe(
      env.PALAMEDES_NEXT_CATALOG_BUILD,
    );
  });

  it("warns that a cross-origin asset host needs CORS for the native import", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { env, hook } = production({ assetPrefix: "https://cdn.example.com/" });
    await hook({ distDir: "/app/.next", projectDir: "/app" });

    expect(env.PALAMEDES_NEXT_CATALOG_BASE).toBe("https://cdn.example.com/_next/static/palamedes/");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("Access-Control-Allow-Origin"));
  });

  it("stays quiet for same-origin path prefixes", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { env, hook } = production({ basePath: "/shop" });
    await hook({ distDir: "/app/.next", projectDir: "/app" });

    expect(env.PALAMEDES_NEXT_CATALOG_BASE).toBe("/shop/_next/static/palamedes/");
    expect(warn).not.toHaveBeenCalled();
  });

  it("keeps webpack client builds on asset delivery in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    const configured = withPalamedes({}, { projectRoot, experimentalClientCatalogAssets: true });
    const rules: { use?: { options?: Record<string, unknown> }[] }[] = [];
    (configured.webpack as unknown as (config: unknown, context: unknown) => unknown)(
      { module: { rules } },
      { isServer: false, dir: projectRoot },
    );
    const delivery = rules
      .flatMap((rule) => rule.use ?? [])
      .map((use) => use.options?.clientCatalogDelivery)
      .filter(Boolean);
    expect(delivery).toEqual(["assets"]);
  });
});
