import { AsyncLocalStorage } from "node:async_hooks";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import { afterEach, describe, expect, it } from "vitest";
import "next/dist/server/node-environment.js";
import { workAsyncStorage } from "next/dist/server/app-render/work-async-storage.external.js";
import { getI18n, resetI18nRuntime, type I18nInstance } from "@palamedes/runtime";

import { createNextServerI18nScope } from "./server";

function unusedRenderMessage(): never {
  throw new Error("renderMessage is not used by request-scope tests.");
}

const require = createRequire(import.meta.url);

describe("@palamedes/next-plugin/server", () => {
  afterEach(() => resetI18nRuntime());

  it("resolves its private Next.js render storage from the installed next", () => {
    // Keep this check tied to the specifier server.ts actually imports, so a
    // Next.js bump that moves the module fails here with a clear message.
    const source = readFileSync(new URL("server.ts", import.meta.url), "utf8");
    const specifier = /from "(next\/dist\/[^"]+)"/u.exec(source)?.[1];
    expect(specifier).toBe("next/dist/server/app-render/work-async-storage.external.js");

    const installedNext = (require("next/package.json") as { version: string }).version;
    let internalModule: { workAsyncStorage?: { getStore?: unknown } };
    try {
      internalModule = require(specifier!) as typeof internalModule;
    } catch (error) {
      throw new Error(
        `next@${installedNext} no longer provides ${specifier}; update @palamedes/next-plugin/server and docs/stability.md before moving the next peer range.`,
        { cause: error },
      );
    }
    expect(typeof internalModule.workAsyncStorage?.getStore, `next@${installedNext}`).toBe(
      "function",
    );
  });

  it("uses the Next render store when React resumes an earlier async context", () => {
    const scope = createNextServerI18nScope<I18nInstance>();
    const i18n: I18nInstance = {
      locale: "de",
      _: (message: string) => message,
      load() {},
      activate() {},
      renderMessage: unusedRenderMessage,
    };

    workAsyncStorage.run({} as never, () => {
      const resumeFromBeforeActivation = AsyncLocalStorage.snapshot();
      scope.activate(i18n);

      resumeFromBeforeActivation(() => {
        expect(scope.get()).toBe(i18n);
        expect(getI18n()).toBe(i18n);
      });
    });
  });
});
