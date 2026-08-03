import { spawnNative } from "./native.mjs"
import { resolveNativeExecutable } from "./platform.mjs"

export async function runCli(argv, options = {}) {
  const resolveExecutable = options.resolveNativeExecutable ?? resolveNativeExecutable
  const runNative = options.runNative ?? spawnNative
  let nativeExecutable = options.nativeExecutable
  try {
    nativeExecutable ??= resolveExecutable()
  } catch (error) {
    const stderr = options.io?.stderr ?? ((value) => process.stderr.write(value))
    stderr(`${error instanceof Error ? error.message : String(error)}\n`)
    return 1
  }
  try {
    return await runNative(argv, {
      cwd: options.cwd ?? process.cwd(),
      nativeExecutable,
    })
  } catch (error) {
    const stderr = options.io?.stderr ?? ((value) => process.stderr.write(value))
    stderr(
      `Could not run Palamedes native CLI: ${error instanceof Error ? error.message : String(error)}\n`
    )
    return 1
  }
}
