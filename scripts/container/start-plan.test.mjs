import { describe, expect, it } from "vitest"
import { CONTAINER_HOST, buildStartArgs, buildStartEnv } from "./start-plan.mjs"

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

  it("runs the matrix start script unchanged for Next.js (binds 0.0.0.0 by default)", () => {
    expect(buildStartArgs({ framework: "nextjs", start: ["start"] })).toEqual(["start"])
  })

  it("leaves the start script untouched for env-driven frameworks", () => {
    expect(buildStartArgs({ framework: "waku", start: ["start"] })).toEqual(["start"])
    expect(buildStartArgs({ framework: "react-router", start: ["start"] })).toEqual(["start"])
    expect(buildStartArgs({ framework: "solidstart", start: ["start"] })).toEqual(["start"])
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
