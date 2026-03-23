import { parseExampleArgs, selectExamples } from "./example-matrix.mjs"

function toDeployRecord(example) {
  return {
    cwd: example.cwd,
    framework: example.framework,
    id: example.id,
    port: example.port,
    publicHost: example.publicHost,
    strategy: example.strategy,
    vercelProject: example.vercelProject,
  }
}

function main() {
  const selected = selectExamples(parseExampleArgs(process.argv)).map(toDeployRecord)
  if (selected.length === 0) {
    throw new Error("No examples matched the provided filters")
  }

  process.stdout.write(JSON.stringify(selected))
}

main()
