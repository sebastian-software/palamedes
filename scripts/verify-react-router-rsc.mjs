import { spawn } from "node:child_process"

import { chromium } from "@playwright/test"

const port = 4071
const baseUrl = `http://127.0.0.1:${port}`

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

await run("pnpm", ["--filter", "@palamedes/example-react-router-rsc-cookie", "build"])

const server = spawn("pnpm", ["--filter", "@palamedes/example-react-router-rsc-cookie", "start"], {
  env: { ...process.env, PORT: String(port) },
  stdio: "inherit",
})

try {
  await waitForServer()
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
    await Promise.all([
      dePage.getByTestId("server-function-trigger").click(),
      enPage.getByTestId("server-function-trigger").click(),
    ])
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
