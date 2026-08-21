#!/usr/bin/env node

const quickstartUrl = "https://palamedes.dev/docs/first-working-translation"
const hasArguments = process.argv.length > 2

process.stderr.write("`create-palamedes` is reserved for future scaffolding.\n")
if (hasArguments) process.stderr.write("This placeholder does not accept project arguments yet.\n")
else process.stderr.write("A project generator is not implemented yet.\n")
process.stderr.write(`Start with the supported quickstart: ${quickstartUrl}\n`)

// A bare invocation reached a real but unavailable entry point; arguments are invalid usage.
process.exitCode = hasArguments ? 2 : 1
