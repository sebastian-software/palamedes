// @vitest-environment jsdom
/* @jsxImportSource @solidjs/web */
import { createSignal } from "solid-js"
import { render } from "@solidjs/web"
import { afterEach, describe, expect, it } from "vitest"

import { createI18n } from "@palamedes/core"
import { resetI18nRuntime, setClientI18n } from "@palamedes/runtime"

import { Trans } from "./index"

describe("@palamedes/solid client Trans", () => {
  afterEach(() => {
    resetI18nRuntime()
    document.body.replaceChildren()
  })

  it("reacts when a signal-backed message prop changes", async () => {
    setClientI18n(createI18n({ locale: "en" }))
    const host = document.createElement("div")
    const [message, setMessage] = createSignal("Hello Ada")
    const dispose = render(() => <Trans message={message()} />, host)

    expect(host.textContent).toBe("Hello Ada")
    setMessage("Hello Lin")
    await Promise.resolve()
    expect(host.textContent).toBe("Hello Lin")

    dispose()
  })
})
