import { spawn } from "node:child_process"

import { chromium } from "@playwright/test"

const port = 4071
const baseUrl = `http://127.0.0.1:${port}`
const TEST_BARRIER_HEADER = "x-palamedes-i18n-test-barrier"
const TEST_BARRIER_REACHED_HEADER = "x-palamedes-i18n-test-barrier-reached"

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", ...options })
    child.once("error", reject)
    child.once("exit", (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${command} ${args.join(" ")} exited with ${code}`))
    })
  })
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

async function waitForServer() {
  let lastError
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(baseUrl)
      if (response.ok) return
    } catch (error) {
      lastError = error
    }
    await delay(250)
  }
  throw new Error(`React Router RSC fixture did not start: ${String(lastError)}`)
}

async function expectText(page, testId, expected) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const actual = await page.getByTestId(testId).textContent()
    if (actual?.trim() === expected) return
    await delay(100)
  }
  throw new Error(`Expected ${testId} to be ${JSON.stringify(expected)}`)
}

async function expectMultiCookieLocale() {
  const response = await fetch(baseUrl, {
    headers: { cookie: "session=production-proof; locale=de" },
  })
  const html = await response.text()
  if (!response.ok || !html.includes("Server-Rendern bestätigte Sprache.")) {
    throw new Error("A production request with session and locale cookies did not render German.")
  }
  // This fixture sits outside EXAMPLE_MATRIX, so its served document locale is
  // asserted here rather than by the matrix smoke checks.
  if (!/<html[^>]*\slang="de"/u.test(html)) {
    throw new Error("A German document was served without a matching html lang attribute.")
  }
}

async function expectDefaultDocumentLocale() {
  const response = await fetch(baseUrl, { headers: { "accept-language": "en" } })
  const html = await response.text()
  if (!response.ok || !/<html[^>]*\slang="en"/u.test(html)) {
    throw new Error("An English document was served without a matching html lang attribute.")
  }
}

async function addServerFunctionBarrier(page, barrierId) {
  await page.route("**/*", async (route) => {
    const request = route.request()
    if (request.method() !== "POST") return route.continue()
    await route.continue({
      headers: { ...request.headers(), [TEST_BARRIER_HEADER]: barrierId },
    })
  })
}

function waitForServerFunctionBarrier(page, barrierId) {
  return page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.headers()[TEST_BARRIER_REACHED_HEADER] === barrierId
  )
}

await run("pnpm", ["--filter", "@palamedes/example-react-router-rsc-cookie", "build"])

const server = spawn("pnpm", ["--filter", "@palamedes/example-react-router-rsc-cookie", "start"], {
  env: { ...process.env, PALAMEDES_I18N_TEST_BARRIER: "1", PORT: String(port) },
  stdio: "inherit",
})

try {
  await waitForServer()
  await expectMultiCookieLocale()
  await expectDefaultDocumentLocale()
  const browser = await chromium.launch({ headless: true })
  try {
    const [deContext, enContext] = await Promise.all([browser.newContext(), browser.newContext()])
    await Promise.all([
      deContext.addCookies([{ name: "locale", value: "de", url: baseUrl }]),
      enContext.addCookies([{ name: "locale", value: "en", url: baseUrl }]),
    ])
    const [dePage, enPage] = await Promise.all([deContext.newPage(), enContext.newPage()])
    await Promise.all([dePage.goto(baseUrl), enPage.goto(baseUrl)])

    await expectText(dePage, "server-rendered-message", "Server-Rendern bestätigte Sprache.")
    await expectText(enPage, "server-rendered-message", "Server render confirmed locale.")
    const barrierId = `react-router-rsc-server-function-${Date.now()}`
    await Promise.all([
      addServerFunctionBarrier(dePage, barrierId),
      addServerFunctionBarrier(enPage, barrierId),
    ])
    const [deResponse, enResponse] = await Promise.all([
      waitForServerFunctionBarrier(dePage, barrierId),
      waitForServerFunctionBarrier(enPage, barrierId),
      dePage.getByTestId("server-function-trigger").click(),
      enPage.getByTestId("server-function-trigger").click(),
    ])
    if (!deResponse.ok() || !enResponse.ok()) {
      throw new Error("A rendezvoused React Router RSC Server Function request failed.")
    }
    await Promise.all([
      expectText(
        dePage,
        "server-function-direct",
        "Direktes Serverfunktionsmakro bestätigte Sprache."
      ),
      expectText(
        enPage,
        "server-function-direct",
        "Direct Server Function macro confirmed locale."
      ),
      expectText(dePage, "server-function-sync", "Synchroner Helfer bestätigte Sprache."),
      expectText(enPage, "server-function-sync", "Synchronous helper confirmed locale."),
      expectText(dePage, "server-function-async", "Asynchroner Helfer bestätigte Sprache."),
      expectText(enPage, "server-function-async", "Asynchronous helper confirmed locale."),
      expectText(
        dePage,
        "server-function-cross-module",
        "Modulübergreifender Helfer bestätigte Sprache."
      ),
      expectText(enPage, "server-function-cross-module", "Cross-module helper confirmed locale."),
      expectText(dePage, "server-function-default", "Parameterstandard bestätigte Sprache."),
      expectText(enPage, "server-function-default", "Default parameter confirmed locale."),
    ])
    await Promise.all([
      expectText(dePage, "server-rendered-message", "Server-Rendern bestätigte Sprache."),
      expectText(enPage, "server-rendered-message", "Server render confirmed locale."),
    ])
    await Promise.all([deContext.close(), enContext.close()])
  } finally {
    await browser.close()
  }
} finally {
  server.kill("SIGTERM")
}
