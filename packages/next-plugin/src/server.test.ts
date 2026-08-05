import { AsyncLocalStorage } from "node:async_hooks"

import { afterEach, describe, expect, it } from "vitest"
import "next/dist/server/node-environment.js"
import { workAsyncStorage } from "next/dist/server/app-render/work-async-storage.external.js"
import { getI18n, resetI18nRuntime, type I18nInstance } from "@palamedes/runtime"

import { createNextServerI18nScope } from "./server"

describe("@palamedes/next-plugin/server", () => {
  afterEach(() => resetI18nRuntime())

  it("uses the Next render store when React resumes an earlier async context", () => {
    const scope = createNextServerI18nScope<I18nInstance>()
    const i18n: I18nInstance = {
      locale: "de",
      _: (message: string) => message,
    }

    workAsyncStorage.run({} as never, () => {
      const resumeFromBeforeActivation = AsyncLocalStorage.snapshot()
      scope.activate(i18n)

      resumeFromBeforeActivation(() => {
        expect(scope.get()).toBe(i18n)
        expect(getI18n()).toBe(i18n)
      })
    })
  })
})
