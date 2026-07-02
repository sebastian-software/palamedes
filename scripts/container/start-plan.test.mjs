import { describe, expect, it } from "vitest"
import { CONTAINER_HOST, buildStartArgs, buildStartEnv, extraStartArgsFor } from "./start-plan.mjs"

describe("extraStartArgsFor", () => {
  it("makes Next.js bind the container host explicitly", () => {
    expect(extraStartArgsFor("nextjs")).toEqual(["-H", CONTAINER_HOST])
  })

  it("adds no CLI override for env-driven frameworks (incl. tanstack, handled elsewhere)", () => {
    expect(extraStartArgsFor("tanstack")).toEqual([])
    expect(extraStartArgsFor("solidstart")).toEqual([])
    expect(extraStartArgsFor("waku")).toEqual([])
    expect(extraStartArgsFor("react-router")).toEqual([])
  })
})

describe("buildStartArgs", () => {
  it("runs vite preview directly for tanstack with a single host/port", () => {
    expect(buildStartArgs({ framework: "tanstack", start: ["preview"], port: 4020 })).toEqual([
      "exec",
      "vite",
      "preview",
      "--host",
      CONTAINER_HOST,
      "--port",
      "4020",
    ])
  })

  it("appends the Next.js host override after a -- separator", () => {
    expect(buildStartArgs({ framework: "nextjs", start: ["start"] })).toEqual([
      "start",
      "--",
      "-H",
      CONTAINER_HOST,
    ])
  })

  it("leaves the start script untouched when no override is needed", () => {
    expect(buildStartArgs({ framework: "waku", start: ["start"] })).toEqual(["start"])
  })
})

describe("buildStartEnv", () => {
  it("forces HOST to the container host and pins the fixed port", () => {
    const env = buildStartEnv(
      { framework: "solidstart", port: 4050, startEnv: { HOST: "127.0.0.1", PORT: "4050" } },
      { EXISTING: "1" }
    )
    expect(env.HOST).toBe(CONTAINER_HOST)
    expect(env.PORT).toBe("4050")
    expect(env.EXISTING).toBe("1")
  })

  it("overrides a matrix startEnv that binds loopback", () => {
    const env = buildStartEnv({
      framework: "solidstart",
      port: 4051,
      startEnv: { HOST: "127.0.0.1" },
    })
    expect(env.HOST).toBe(CONTAINER_HOST)
  })
})
