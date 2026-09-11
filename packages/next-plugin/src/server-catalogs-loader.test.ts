import { createRequire } from "node:module";
import Module from "node:module";
import vm from "node:vm";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const moduleLoader = Module as unknown as {
  _load(request: string, parent: unknown, isMain: boolean): unknown;
};
const originalLoad = moduleLoader._load;
const loaderPath = "../palamedes-server-catalogs-loader.cjs";

afterEach(() => {
  moduleLoader._load = originalLoad;
  delete require.cache[require.resolve(loaderPath)];
});

it("generates lazy complete server catalogs in config order and watches imported config", async () => {
  const config = {
    rootDir: path.resolve("/project"),
    configPath: "/project/palamedes.yaml",
    configDependencies: ["/project/palamedes.yaml", "/project/config/locales.ts"],
    locales: ["en", "de"],
    catalogs: [{ path: "messages/{locale}" }, { path: "overrides/{locale}" }],
  };
  const loadPalamedesConfigSync = vi.fn(() => config);
  moduleLoader._load = (request, parent, isMain) => {
    if (request === "@palamedes/config") {
      return {
        ...(originalLoad.call(Module, request, parent, isMain) as object),
        loadPalamedesConfigSync,
      };
    }
    return originalLoad.call(Module, request, parent, isMain);
  };
  const dependencies: string[] = [];
  const loader = require(loaderPath) as (this: object) => string;
  const code = loader.call({
    resourcePath: path.join(
      config.rootDir,
      "node_modules/@palamedes/next-plugin/dist/server-catalogs.mjs",
    ),
    getOptions: () => ({ cwd: "/project", configPath: config.configPath }),
    addDependency: (dependency: string) => dependencies.push(dependency),
  });
  expect(dependencies).toEqual(config.configDependencies);
  expect(loadPalamedesConfigSync).toHaveBeenCalledWith({
    cwd: "/project",
    configPath: config.configPath,
  });
  const imports: string[] = [];
  let load: (context: { locale: string }) => Promise<unknown[]>;
  // Execute the generated loader selection, replacing only host imports.
  const context = vm.createContext({
    createServerCatalogStore(options: { load: typeof load }) {
      load = options.load;
      return { load: (locale: string) => load({ locale }) };
    },
    async importCatalog(specifier: string) {
      imports.push(specifier);
      return { messages: { from: specifier } };
    },
  });
  vm.runInContext(
    code
      .replace(/^import .*;\n/u, "")
      .replaceAll("import(", "importCatalog(")
      .replace("export function", "function"),
    context,
  );
  expect(imports).toEqual([]);
  const messages = await vm.runInContext('loadServerCatalog("de")', context);
  expect(imports.map((specifier) => specifier.replaceAll("\\", "/"))).toEqual([
    "../../../../messages/de.po",
    "../../../../overrides/de.po",
  ]);
  expect(messages).toHaveLength(2);
  expect(() => vm.runInContext('loadServerCatalog("__proto__")', context)).toThrow("Unsupported");
});
