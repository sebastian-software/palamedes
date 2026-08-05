import { spawn } from "node:child_process"
import { createRequire } from "node:module"

const port = 4198
const baseUrl = `http://127.0.0.1:${port}`
const require = createRequire(import.meta.url)
const nextCli = require.resolve("next/dist/bin/next")
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

async function assertServerActionLocale(locale, expected) {
  const initialResponse = await fetch(`${baseUrl}/server-action-probe`, {
    headers: { "accept-language": locale },
  })
  const initialBody = await initialResponse.text()
  const actionName = initialBody.match(/name="(\$ACTION_ID_[^"]+)"/)?.[1]

  if (!actionName) {
    throw new Error(`Could not find the generated Server Action form field for ${locale}`)
  }

  const formData = new FormData()
  formData.set(actionName, "")

  const actionResponse = await fetch(`${baseUrl}/server-action-probe`, {
    method: "POST",
    headers: {
      "accept-language": locale,
      origin: baseUrl,
    },
    body: formData,
  })
  const actionBody = await actionResponse.text()

  if (
    actionResponse.status !== 200 ||
    !actionBody.includes(`data-action-locale="${locale}"`) ||
    !actionBody.includes(`>${expected}</output>`)
  ) {
    throw new Error(
      `Expected ${locale} Server Action to return its localized request result, got ${actionResponse.status} at ${actionResponse.url}: ${actionBody.slice(0, 500)}`
    )
  }
}

const server = spawn(process.execPath, [nextCli, "start", "--port", String(port)], {
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
  await Promise.all(
    Array.from({ length: 12 }, (_, index) =>
      index % 2 === 0
        ? assertServerActionLocale("en", "Server action confirmed locale en.")
        : assertServerActionLocale("de", "Server-Action bestätigte Sprache de.")
    )
  )
  console.log(
    "Next.js production RSC and Server Action scopes remained request-local across suspension"
  )
} catch (error) {
  console.error(serverOutput)
  throw error
} finally {
  await stopServer(server)
}
