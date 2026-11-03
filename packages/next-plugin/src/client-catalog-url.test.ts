import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

const emitClientCatalogAssets = vi.hoisted(() => vi.fn(async () => ({ locales: {} })));
vi.mock("./client-catalog-assets", () => ({ emitClientCatalogAssets }));
vi.mock("./client-catalog-trace", () => ({ traceClientCatalogManifest: vi.fn() }));

import { clientCatalogPublicPrefix, crossOriginClientCatalogHost } from "./client-catalog-url";
import { withPalamedes } from "./index";

const projectRoot = fileURLToPath(new URL("../../../examples/nextjs-route", import.meta.url));

afterEach(() => {
  vi.unstubAllEnvs();
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
  function productionHook(config: Parameters<typeof withPalamedes>[0]) {
    vi.stubEnv("NODE_ENV", "production");
    const configured = withPalamedes(config, {
      projectRoot,
      experimentalClientCatalogAssets: true,
    });
    const hook = configured.compiler?.runAfterProductionCompile;
    expect(hook).toBeTypeOf("function");
    return hook!;
  }

  it("passes Next's /_next/ prefix to the post-compile step", async () => {
    const userHook = vi.fn(async () => {});
    const hook = productionHook({
      basePath: "/shop",
      assetPrefix: "/cdn/",
      compiler: { runAfterProductionCompile: userHook },
    });
    await hook({ distDir: "/app/.next", projectDir: "/app" });

    expect(userHook).toHaveBeenCalledOnce();
    expect(emitClientCatalogAssets).toHaveBeenCalledWith(
      expect.objectContaining({ distDir: "/app/.next", publicPrefix: "/cdn" }),
    );
  });

  it("warns that a cross-origin asset host needs CORS for the native import", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await productionHook({ assetPrefix: "https://cdn.example.com/" })({
      distDir: "/app/.next",
      projectDir: "/app",
    });

    expect(emitClientCatalogAssets).toHaveBeenCalledWith(
      expect.objectContaining({ publicPrefix: "https://cdn.example.com" }),
    );
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("Access-Control-Allow-Origin"));
  });

  it("stays quiet for same-origin path prefixes", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await productionHook({ basePath: "/shop" })({ distDir: "/app/.next", projectDir: "/app" });

    expect(emitClientCatalogAssets).toHaveBeenCalledWith(
      expect.objectContaining({ publicPrefix: "/shop" }),
    );
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
