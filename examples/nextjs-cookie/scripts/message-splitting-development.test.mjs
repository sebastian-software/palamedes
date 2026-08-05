import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { once } from "node:events"
import { existsSync } from "node:fs"
import { readFile, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"

import { chromium } from "@playwright/test"

const port = 4199
const baseUrl = `http://127.0.0.1:${port}`
const require = createRequire(import.meta.url)
const nextCli = require.resolve("next/dist/bin/next")
const catalogUrl = new URL("../src/locales/de.po", import.meta.url)
const nextEnvUrl = new URL("../next-env.d.ts", import.meta.url)
const [originalCatalog, originalNextEnv] = await Promise.all([
  readFile(catalogUrl, "utf8"),
  readFile(nextEnvUrl, "utf8"),
])
const changedCatalog = originalCatalog.replace(
  'msgstr "In den Warenkorb"',
  'msgstr "In den Warenkorb (Dev-Update)"'
)
assert.notEqual(changedCatalog, originalCatalog)

const executablePath = [
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
  "/opt/pw-browsers/chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
].find((candidate) => candidate && existsSync(candidate))

const server = spawn(process.execPath, [nextCli, "dev", "--port", String(port)], {
  cwd: new URL("..", import.meta.url),
  env: { ...process.env, NODE_ENV: "development" },
  stdio: ["ignore", "pipe", "pipe"],
})
let serverOutput = ""
server.stdout.on("data", (chunk) => {
  serverOutput += chunk
})
server.stderr.on("data", (chunk) => {
  serverOutput += chunk
})

async function waitForServer() {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(baseUrl, { headers: { "accept-language": "de" } })
      if (response.ok) return
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`Next dev server did not start:\n${serverOutput}`)
}

async function stopServer() {
  if (server.exitCode !== null) return
  server.kill("SIGTERM")
  await Promise.race([once(server, "exit"), new Promise((resolve) => setTimeout(resolve, 5000))])
}

let browser
try {
  await waitForServer()
  browser = await chromium.launch(executablePath ? { executablePath } : undefined)
  const context = await browser.newContext({
    extraHTTPHeaders: { "accept-language": "de" },
    locale: "de",
  })
  const page = await context.newPage()
  const callToAction = page.locator(".ticket .cta")
  await page.goto(baseUrl)
  await callToAction.waitFor()
  assert.equal(await callToAction.textContent(), "In den Warenkorb")

  await writeFile(catalogUrl, changedCatalog)

  const deadline = Date.now() + 15_000
  let updatedText = ""
  while (Date.now() < deadline) {
    await page.reload()
    await callToAction.waitFor()
    updatedText = (await callToAction.textContent()) ?? ""
    if (updatedText === "In den Warenkorb (Dev-Update)") break
    await new Promise((resolve) => setTimeout(resolve, 200))
  }

  assert.equal(updatedText, "In den Warenkorb (Dev-Update)")
  console.log("Next development catalog invalidation passed through document reload")
  await context.close()
} catch (error) {
  console.error(serverOutput)
  throw error
} finally {
  await browser?.close()
  await stopServer()
  await Promise.all([
    writeFile(catalogUrl, originalCatalog),
    writeFile(nextEnvUrl, originalNextEnv),
  ])
}
