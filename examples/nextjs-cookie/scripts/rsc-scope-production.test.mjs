import { spawn } from "node:child_process"

const port = 4198
const baseUrl = `http://127.0.0.1:${port}`
let serverOutput = ""

function waitForExit(child) {
  return new Promise((resolve) => child.once("exit", resolve))
}

async function stopServer(child) {
  if (child.exitCode !== null || child.signalCode !== null) return

  child.kill("SIGTERM")
  await Promise.race([waitForExit(child), new Promise((resolve) => setTimeout(resolve, 2000))])

  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL")
    await waitForExit(child)
  }
}

async function waitForServer() {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/rsc-scope-probe`, {
        headers: { "accept-language": "en" },
      })
      if (response.status >= 200) return
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`Timed out waiting for Next.js on port ${port}`)
}

async function assertLocale(locale, expected) {
  const response = await fetch(`${baseUrl}/rsc-scope-probe`, {
    headers: { "accept-language": locale },
  })
  const body = await response.text()

  if (response.status !== 200 || !body.includes(`data-probe-locale="${locale}"`)) {
    throw new Error(
      `Expected ${locale} request to return 200 with its request locale, got ${response.status}`
    )
  }
  if (!body.includes(`>${expected}</output>`)) {
    throw new Error(`Expected ${locale} response to contain ${JSON.stringify(expected)}`)
  }
}

const server = spawn("pnpm", ["exec", "next", "start", "--port", String(port)], {
  cwd: new URL("..", import.meta.url),
  env: { ...process.env, NODE_ENV: "production" },
  stdio: ["ignore", "pipe", "pipe"],
})

for (const stream of [server.stdout, server.stderr]) {
  stream.setEncoding("utf8")
  stream.on("data", (chunk) => {
    serverOutput += chunk
  })
}

try {
  await waitForServer()
  await Promise.all(
    Array.from({ length: 12 }, (_, index) =>
      index % 2 === 0 ? assertLocale("en", "More tickets") : assertLocale("de", "Mehr Tickets")
    )
  )
  console.log("Next.js production RSC scope remained request-local across suspension")
} catch (error) {
  console.error(serverOutput)
  throw error
} finally {
  await stopServer(server)
}
