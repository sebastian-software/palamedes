const request = JSON.parse(await readStdin())

if (request.kind === "describe") {
  emit({
    event: "manifest",
    name: "binary",
    protocolVersion: 1,
    commands: {
      inspect: { description: "Inspect the project through the binary protocol." },
      fail: { description: "Report a failing workflow result." },
      crash: { description: "Exit without emitting a result event." },
    },
  })
  process.exit(0)
}

if (request.command === "inspect") {
  emit({
    event: "diagnostic",
    severity: "info",
    code: "BINARY_INSPECTED",
    message: `Inspected ${request.catalogs.length} catalog definitions.`,
  })
  emit({ event: "output", text: "inspecting" })
  emit({
    event: "result",
    text: "done",
    data: {
      args: request.args,
      options: request.options,
      rootDir: request.config.rootDir,
      locales: request.catalogs[0].locales.map((entry) => entry.locale),
      native: process.env.PALAMEDES_NATIVE ?? null,
      json: request.json,
      interactive: request.interactive,
    },
    exitCode: 0,
  })
  process.exit(0)
}

if (request.command === "fail") {
  emit({
    event: "diagnostic",
    severity: "error",
    code: "BINARY_FAILED",
    message: "Binary workflow failed.",
  })
  emit({ event: "result", exitCode: 9 })
  process.exit(0)
}

if (request.command === "crash") {
  process.exit(5)
}

process.exit(2)

function emit(event) {
  process.stdout.write(`${JSON.stringify(event)}\n`)
}

async function readStdin() {
  let input = ""
  process.stdin.setEncoding("utf8")
  for await (const chunk of process.stdin) {
    input += chunk
  }
  return input
}
