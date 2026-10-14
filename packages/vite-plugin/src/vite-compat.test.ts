import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as PalamedesConfigModule from "@palamedes/config";
import type * as PalamedesCoreNodeModule from "@palamedes/core-node";
import type * as PalamedesTransformModule from "@palamedes/transform";
import type * as ViteModule from "vite";
import type { palamedes as PalamedesFactory } from "./index";

const mocks = vi.hoisted(() => ({
  analyzeMdxNative: vi.fn(),
  loadPalamedesConfig: vi.fn(),
  rolldownVersion: undefined as string | undefined,
  transformPalamedesMacros: vi.fn(),
  viteVersion: "7.4.0",
}));

vi.mock("vite", async (importOriginal) => {
  const actual = await importOriginal<typeof ViteModule>();
  return {
    ...actual,
    get version() {
      return mocks.viteVersion;
    },
    get rolldownVersion() {
      return mocks.rolldownVersion;
    },
  };
});

vi.mock("@palamedes/config", async (importOriginal) => {
  const actual = await importOriginal<typeof PalamedesConfigModule>();
  return {
    ...actual,
    loadPalamedesConfig: mocks.loadPalamedesConfig,
  };
});

vi.mock("@palamedes/core-node", async (importOriginal) => ({
  ...(await importOriginal<typeof PalamedesCoreNodeModule>()),
  analyzeMdxNative: mocks.analyzeMdxNative,
}));

vi.mock("@palamedes/transform", async (importOriginal) => ({
  ...(await importOriginal<typeof PalamedesTransformModule>()),
  transformPalamedesMacros: mocks.transformPalamedesMacros,
}));

let palamedes: typeof PalamedesFactory;

async function loadPalamedes(version = "7.4.0") {
  mocks.viteVersion = version;
  vi.resetModules();
  return (await import("./index")).palamedes;
}

beforeEach(async () => {
  mocks.rolldownVersion = undefined;
  mocks.analyzeMdxNative.mockReset();
  mocks.loadPalamedesConfig.mockReset();
  mocks.transformPalamedesMacros.mockReset();
  palamedes = await loadPalamedes();
});

function mdxTransform(options: Parameters<typeof palamedes>[0] = {}) {
  const transform = palamedes(options).find((plugin) => plugin.name === "palamedes:mdx")?.transform;
  if (typeof transform === "function") {
    return transform;
  }
  if (transform && typeof transform === "object") {
    return transform.handler;
  }
  throw new TypeError("Expected palamedes:mdx transform hook");
}

function mdxConfig(options: Parameters<typeof palamedes>[0] = {}) {
  const config = palamedes(options).find((plugin) => plugin.name === "palamedes:mdx")?.config;
  if (typeof config !== "function") {
    throw new TypeError("Expected palamedes:mdx config hook");
  }
  return config;
}

describe("React MDX compatibility with Rollup-based Vite", () => {
  it("does not pass Rolldown-only module types to Vite 7", async () => {
    mocks.loadPalamedesConfig.mockResolvedValue({
      configPath: "/repo/palamedes.yaml",
      rootDir: "/repo",
      locales: ["en"],
      sourceLocale: "en",
      catalogs: [],
    });

    await expect(mdxConfig().call({} as any, {} as any, {} as any)).resolves.toBeUndefined();
  });

  it("stops React MDX on Vite 7 before generated JSX reaches Rollup", async () => {
    mocks.loadPalamedesConfig.mockResolvedValue({
      configPath: "/repo/palamedes.yaml",
      rootDir: "/repo",
      locales: ["en"],
      sourceLocale: "en",
      catalogs: [],
    });
    const error = vi.fn((message: string) => {
      throw new Error(message);
    });

    await expect(
      mdxTransform().call({ addWatchFile() {}, error } as any, "# Welcome", "/repo/page.mdx"),
    ).rejects.toThrow(
      "Palamedes React MDX compilation requires Vite 8 or rolldown-vite because Rollup-based Vite cannot parse generated JSX from .mdx files.",
    );
    expect(mocks.analyzeMdxNative).not.toHaveBeenCalled();
  });

  it("enables React MDX module types on rolldown-vite 7", async () => {
    mocks.rolldownVersion = "1.0.0";
    mocks.loadPalamedesConfig.mockResolvedValue({
      configPath: "/repo/palamedes.yaml",
      rootDir: "/repo",
      locales: ["en"],
      sourceLocale: "en",
      catalogs: [],
    });
    mocks.analyzeMdxNative.mockClear();
    mocks.analyzeMdxNative.mockReturnValue({
      code: "export default function Page() {}",
      compiledIds: [],
      diagnostics: [],
      map: null,
    });

    await expect(mdxConfig().call({} as any, {} as any, {} as any)).resolves.toEqual({
      build: { rollupOptions: { moduleTypes: { ".mdx": "jsx" } } },
    });
    await expect(
      mdxTransform().call(
        { addWatchFile() {}, error: vi.fn() } as any,
        "# Welcome",
        "/repo/page.mdx",
      ),
    ).resolves.toEqual({ code: "export default function Page() {}", map: null, moduleType: "jsx" });
    expect(mocks.analyzeMdxNative).toHaveBeenCalledOnce();
  });

  it("keeps Solid MDX available on Vite 7 without React's module type", async () => {
    mocks.loadPalamedesConfig.mockResolvedValue({
      configPath: "/repo/palamedes.yaml",
      rootDir: "/repo",
      locales: ["en"],
      sourceLocale: "en",
      catalogs: [],
    });
    mocks.analyzeMdxNative.mockReturnValue({
      code: "export default function Page() {}",
      compiledIds: [],
      diagnostics: [],
      map: null,
    });

    await expect(
      mdxTransform({ mdx: { framework: "solid" } }).call(
        { addWatchFile() {} } as any,
        "# Welcome",
        "/repo/page.mdx",
      ),
    ).resolves.toEqual({ code: "export default function Page() {}", map: null });
  });

  it("does not add an MDX compiler when it is disabled", () => {
    expect(palamedes({ mdx: false }).some((plugin) => plugin.name === "palamedes:mdx")).toBe(false);
  });
});

describe("declarative macro transform filters", () => {
  it("declares conservative ID filters and macro package code filters", () => {
    const plugin = palamedes({ mdx: false }).find(
      (candidate) => candidate.name === "palamedes:transform",
    );
    const hook = plugin?.transform;
    if (!hook || typeof hook === "function") {
      throw new TypeError("Expected an object-form macro transform hook");
    }

    expect(hook.filter?.id).toEqual({
      include: [/\.([cm]?[jt]s|[jt]sx)$/, /\?/],
    });
    expect(hook.filter?.code).toEqual([
      "@palamedes/core/macro",
      "@palamedes/react/macro",
      "@palamedes/remix/macro",
      "@palamedes/solid/macro",
    ]);
  });

  it("preserves macro transform output when the filter matches", async () => {
    const plugin = palamedes({ mdx: false }).find(
      (candidate) => candidate.name === "palamedes:transform",
    );
    const hook = plugin?.transform;
    if (!hook || typeof hook === "function") {
      throw new TypeError("Expected an object-form macro transform hook");
    }
    const code = 'import { t } from "@palamedes/react/macro";';
    expect(hook.filter?.code).toContain("@palamedes/react/macro");
    const result = {
      code: "export const translated = true;",
      map: null,
      hasChanged: true,
      compiledIds: [],
    };
    mocks.transformPalamedesMacros.mockReturnValue(result);

    expect(await hook.handler.call({ error: vi.fn() } as never, code, "/repo/page.ts")).toEqual({
      code: result.code,
      map: null,
    });
    expect(mocks.transformPalamedesMacros).toHaveBeenCalledOnce();
  });

  it("keeps the handler fallback for Vite 6.2, which ignores filter metadata", async () => {
    const vite6Palamedes = await loadPalamedes("6.2.0");
    const hook = vite6Palamedes({ mdx: false }).find(
      (candidate) => candidate.name === "palamedes:transform",
    )?.transform;
    if (!hook || typeof hook === "function") {
      throw new TypeError("Expected an object-form macro transform hook");
    }

    // Vite 6.2 invokes the object-form handler without applying its unknown
    // `filter` property; the handler's includes() check must still reject it.
    expect(
      await hook.handler.call(
        { error: vi.fn() } as never,
        "export const answer = 42;",
        "/repo/page.ts",
      ),
    ).toBeNull();
    expect(mocks.transformPalamedesMacros).not.toHaveBeenCalled();
  });

  it("keeps function-form transform hooks for Vite 3", async () => {
    const vite3Palamedes = await loadPalamedes("3.2.10");
    const hook = vite3Palamedes({ mdx: false }).find(
      (candidate) => candidate.name === "palamedes:transform",
    )?.transform;
    expect(typeof hook).toBe("function");
    if (typeof hook !== "function") {
      throw new TypeError("Expected a function-form macro transform hook for Vite 3");
    }

    expect(
      await hook.call({ error: vi.fn() } as never, "export const answer = 42;", "/repo/page.ts"),
    ).toBeNull();
    expect(mocks.transformPalamedesMacros).not.toHaveBeenCalled();
  });

  it("declares an MDX ID filter while retaining the transform handler", () => {
    const hook = palamedes().find((plugin) => plugin.name === "palamedes:mdx")?.transform;
    if (!hook || typeof hook === "function") {
      throw new TypeError("Expected an object-form MDX transform hook");
    }

    const idFilter = hook.filter?.id;
    expect(idFilter).toEqual(/\.mdx(?:\?.*)?$/i);
    expect(typeof hook.handler).toBe("function");
  });
});
