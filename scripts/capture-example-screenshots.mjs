import { runNodeScript } from "./example-process.mjs"

async function main() {
  const args = process.argv.slice(2)
  await runNodeScript("./scripts/verify-examples.mjs", args)
  await runNodeScript("./scripts/verify-examples-browser.mjs", ["--capture-screenshots", ...args])
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
