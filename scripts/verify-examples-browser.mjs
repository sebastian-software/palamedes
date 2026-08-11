import { spawn } from "node:child_process"
import http from "node:http"
import path from "node:path"
import { parseExampleArgs, ROOT, selectBrowserExamples } from "./example-matrix.mjs"
import { ensurePortFree, startCommand, stopCommand } from "./example-process.mjs"

function parseBrowserArgs(argv) {
  return {
    captureScreenshots: argv.includes("--capture-screenshots"),
    screenshotDir: path.resolve(
      ROOT,
      process.env.PALAMEDES_SCREENSHOT_DIR ?? "docs/example-screenshots"
    ),
  }
}

function runVitest(example, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "pnpm",
      [
        "exec",
        "vitest",
        "--config",
        "vitest.examples.config.mjs",
        "--run",
        "tests/examples-browser/examples.browser.test.js",
      ],
      {
        cwd: ROOT,
        env: {
          ...process.env,
          PALAMEDES_VERIFY_EXAMPLE_ID: example.id,
          PALAMEDES_VERIFY_BASE_URL: `http://127.0.0.1:${example.port}`,
          PALAMEDES_VERIFY_FRAMEWORK: example.framework,
          PALAMEDES_VERIFY_HOST_MISMATCH_URL:
            example.strategy === "route" ? `http://de.lvh.me:${example.port}/en` : "",
          // Subdomain examples encode the locale in the leftmost host label, and
          // 127.0.0.1 has none, so the browser test enters through a locale host.
          PALAMEDES_VERIFY_SUBDOMAIN_URL:
            example.strategy === "subdomain" ? `http://en.lvh.me:${example.port}/` : "",
          // TLD examples derive the locale from the top-level domain. `.com` is the
          // non-authoritative entry point (falls back to the browser locale); the
          // browser test maps the four test domains to 127.0.0.1 via Chromium's
          // --host-resolver-rules, so no real DNS or /etc/hosts is needed.
          PALAMEDES_VERIFY_TLD_URL:
            example.strategy === "tld" ? `http://palamedes-i18n.com:${example.port}/` : "",
          PALAMEDES_VERIFY_STRATEGY: example.strategy,
          PALAMEDES_CAPTURE_SCREENSHOTS: options.captureScreenshots ? "1" : "0",
          PALAMEDES_SCREENSHOT_DIR: options.screenshotDir,
        },
        stdio: "inherit",
      }
    )

    child.on("exit", (code) => {
      if (code === 0) {
        resolve()
      } else {
        reject(
          new Error(`Vitest browser verification failed for ${example.id} with exit code ${code}`)
        )
      }
    })
  })
}

function requestText(port, requestPath) {
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        host: "127.0.0.1",
        method: "GET",
        path: requestPath,
        port,
      },
      (response) => {
        const chunks = []
        response.on("data", (chunk) => chunks.push(chunk))
        response.on("end", () => {
          resolve({
            body: Buffer.concat(chunks).toString("utf8"),
            statusCode: response.statusCode ?? 0,
          })
        })
      }
    )

    request.on("error", reject)
    request.end()
  })
}

async function waitForServer(port, pathToCheck = "/") {
  const startedAt = Date.now()
  while (Date.now() - startedAt < 30_000) {
    try {
      const response = await requestText(port, pathToCheck)
      if (response.statusCode >= 200) {
        return
      }
    } catch {}

    await new Promise((resolve) => setTimeout(resolve, 300))
  }

  throw new Error(`Timed out waiting for server on port ${port}`)
}

async function verifyExample(example, options) {
  await ensurePortFree(example.port)
  const child = startCommand({
    args: example.start,
    cwd: example.cwd,
    env: example.startEnv,
  })

  try {
    await waitForServer(example.port, example.strategy === "route" ? "/en" : "/")
    await runVitest(example, options)
  } finally {
    await stopCommand(child)
    await ensurePortFree(example.port)
  }
}

async function main() {
  const browserOptions = parseBrowserArgs(process.argv)
  const selected = selectBrowserExamples(parseExampleArgs(process.argv))

  if (selected.length === 0) {
    throw new Error("No browser-verifiable examples matched the provided filters")
  }

  for (const example of selected) {
    console.log(`\n[verify:browser] ${example.id} on port ${example.port}`)
    await verifyExample(example, browserOptions)
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
