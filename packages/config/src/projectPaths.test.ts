import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  createPalamedesSourceFilter,
  resolvePalamedesConfigPath,
  resolvePalamedesProjectRoot,
} from "./projectPaths";

const projectRoot = path.resolve("/workspace/apps/web");

describe("resolvePalamedesConfigPath", () => {
  it("resolves a relative configPath from projectRoot, not the working directory", () => {
    expect(path.resolve(process.cwd())).not.toBe(projectRoot);
    expect(resolvePalamedesConfigPath(projectRoot, "config/palamedes.yaml")).toBe(
      path.join(projectRoot, "config", "palamedes.yaml"),
    );
  });

  it("keeps an absolute configPath", () => {
    const absolute = path.resolve("/elsewhere/palamedes.yaml");
    expect(resolvePalamedesConfigPath(projectRoot, absolute)).toBe(absolute);
  });

  it("returns undefined without a configPath so discovery stays automatic", () => {
    expect(resolvePalamedesConfigPath(projectRoot, undefined)).toBeUndefined();
    expect(resolvePalamedesConfigPath(projectRoot, "")).toBeUndefined();
  });
});

describe("resolvePalamedesProjectRoot", () => {
  it("resolves relative values from the working directory and falls back when unset", () => {
    expect(resolvePalamedesProjectRoot("apps/web")).toBe(path.resolve("apps/web"));
    expect(resolvePalamedesProjectRoot(undefined, projectRoot)).toBe(projectRoot);
    expect(resolvePalamedesProjectRoot(undefined)).toBe(path.resolve(process.cwd()));
  });
});

describe("createPalamedesSourceFilter", () => {
  const file = (relative: string) => path.join(projectRoot, relative);

  it("resolves relative string globs from projectRoot", () => {
    const filter = createPalamedesSourceFilter("src/**/*.ts", undefined, { projectRoot });

    expect(filter(file("src/page.ts"))).toBe(true);
    expect(filter(file("src/nested/.hidden/page.ts"))).toBe(true);
    expect(filter(file("lib/page.ts"))).toBe(false);
    expect(filter(path.join(path.dirname(projectRoot), "other", "src", "page.ts"))).toBe(false);
  });

  it("matches **-prefixed and absolute globs as written", () => {
    const absoluteGlob = `${file("lib").replaceAll("\\", "/")}/*.ts`;
    const filter = createPalamedesSourceFilter(["**/*.custom", absoluteGlob], undefined, {
      projectRoot,
    });

    expect(filter("/anywhere/page.custom")).toBe(true);
    expect(filter(file("lib/page.ts"))).toBe(true);
    expect(filter(file("src/page.ts"))).toBe(false);
  });

  it("accepts a RegExp and resets stateful RegExps", () => {
    const filter = createPalamedesSourceFilter(/\.tsx$/g, undefined, { projectRoot });

    expect(filter(file("src/page.tsx"))).toBe(true);
    expect(filter(file("src/page.tsx"))).toBe(true);
    expect(filter(file("src/page.ts"))).toBe(false);
  });

  it("combines string globs and RegExps in arrays, with exclude winning", () => {
    const filter = createPalamedesSourceFilter(
      ["src/**/*.ts", /\.mts$/],
      ["src/legacy/**", /\.gen\./],
      {
        projectRoot,
      },
    );

    expect(filter(file("src/page.ts"))).toBe(true);
    expect(filter(file("scripts/build.mts"))).toBe(true);
    expect(filter(file("src/legacy/old.ts"))).toBe(false);
    expect(filter(file("src/page.gen.ts"))).toBe(false);
    expect(filter(file("scripts/build.js"))).toBe(false);
  });

  it("accepts everything not excluded when include is empty or null", () => {
    for (const include of [undefined, null, []]) {
      const filter = createPalamedesSourceFilter(include, /node_modules/, { projectRoot });
      expect(filter(file("src/page.css"))).toBe(true);
      expect(filter(file("node_modules/pkg/index.js"))).toBe(false);
    }
  });

  it("matches Windows-style separators and rejects virtual module IDs", () => {
    const filter = createPalamedesSourceFilter(/\/src\/.*\.ts$/, undefined, { projectRoot });

    expect(filter("C:\\workspace\\apps\\web\\src\\page.ts")).toBe(true);
    expect(filter("\0virtual:src/page.ts")).toBe(false);
  });
});
