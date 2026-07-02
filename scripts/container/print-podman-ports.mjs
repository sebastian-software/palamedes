#!/usr/bin/env node
// Print the `-p host:container` publish flags for `podman run`, derived from the
// shared EXAMPLE_MATRIX so the run command never drifts from the ports the
// servers actually bind. Usage:
//
//   podman run --init $(node ./scripts/container/print-podman-ports.mjs) palamedes-examples

import process from "node:process"
import { EXAMPLE_MATRIX } from "../example-matrix.mjs"

const flags = EXAMPLE_MATRIX.flatMap((example) => ["-p", `${example.port}:${example.port}`])
process.stdout.write(`${flags.join(" ")}\n`)
