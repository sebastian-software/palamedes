#!/usr/bin/env node

const quickstartUrl = "https://palamedes.dev/docs/first-working-translation"
const hasArguments = process.argv.length > 2

process.stderr.write("The `palamedes` package is currently a placeholder.\n")
if (hasArguments) process.stderr.write("This placeholder does not accept command arguments yet.\n")
else process.stderr.write("Use `@palamedes/cli` for the command-line tool today.\n")
process.stderr.write(`Start with the supported quickstart: ${quickstartUrl}\n`)

// A bare invocation reached a real but unavailable entry point; arguments are invalid usage.
process.exitCode = hasArguments ? 2 : 1
