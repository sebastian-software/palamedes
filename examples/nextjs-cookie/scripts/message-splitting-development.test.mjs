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
const sourceCatalogUrl = new URL("../src/locales/en.po", import.meta.url)
const configUrl = new URL("../palamedes.yaml", import.meta.url)
const nextEnvUrl = new URL("../next-env.d.ts", import.meta.url)
const [originalCatalog, originalSourceCatalog, originalConfig, originalNextEnv] = await Promise.all(
  [
    readFile(catalogUrl, "utf8"),
    readFile(sourceCatalogUrl, "utf8"),
    readFile(configUrl, "utf8"),
    readFile(nextEnvUrl, "utf8"),
  ]
)
const changedCatalog = originalCatalog.replace(
  'msgstr "In den Warenkorb"',
  'msgstr "In den Warenkorb (Dev-Update)"'
)
assert.notEqual(changedCatalog, originalCatalog)
const changedSourceCatalog = originalSourceCatalog.replace(
  'msgstr "Source fallback development probe"',
  'msgstr "Source fallback development probe (Dev-Update)"'
)
assert.notEqual(changedSourceCatalog, originalSourceCatalog)
const changedConfig = originalConfig.replace(
  "source-locale: en\n",
  "source-locale: en\nfallback-locales:\n  de: [es]\n"
)
assert.notEqual(changedConfig, originalConfig)

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

async function reloadUntil(page, locator, expectedText) {
  const deadline = Date.now() + 15_000
  let actualText = ""
  while (Date.now() < deadline) {
    await page.reload()
    await locator.waitFor()
    actualText = (await locator.textContent()) ?? ""
    if (actualText === expectedText) return
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  assert.equal(actualText, expectedText)
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
  const fallbackProbe = page.locator(".ticket .fallback-probe")
  await page.goto(baseUrl)
  await callToAction.waitFor()
  assert.equal(await callToAction.textContent(), "In den Warenkorb")
  assert.equal(await fallbackProbe.textContent(), "Source fallback development probe")

  await writeFile(catalogUrl, changedCatalog)
  await reloadUntil(page, callToAction, "In den Warenkorb (Dev-Update)")

  await writeFile(sourceCatalogUrl, changedSourceCatalog)
  await reloadUntil(page, fallbackProbe, "Source fallback development probe (Dev-Update)")

  await writeFile(configUrl, changedConfig)
  await reloadUntil(page, fallbackProbe, "Sondeo de reserva de desarrollo")

  // This is a Turbopack dev test and verifies the supported document-reload
  // fallback. Webpack's top-level-await client modules are build-covered, but
  // do not have an equivalent HMR contract asserted here.
  console.log("Next development catalog and config invalidation passed through document reload")
  await context.close()
} catch (error) {
  console.error(serverOutput)
  throw error
} finally {
  await browser?.close()
  await stopServer()
  await Promise.all([
    writeFile(catalogUrl, originalCatalog),
    writeFile(sourceCatalogUrl, originalSourceCatalog),
    writeFile(configUrl, originalConfig),
    writeFile(nextEnvUrl, originalNextEnv),
  ])
}
