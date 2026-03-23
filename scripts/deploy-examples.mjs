import { access, appendFile, readFile } from "node:fs/promises"
import { spawn } from "node:child_process"
import { parseExampleArgs, selectExamples } from "./example-matrix.mjs"

function parseArgs(argv) {
  const result = {
    dryRun: false,
    environment: "preview",
    githubOutput: null,
    summaryFile: null,
  }

  for (let index = 2; index < argv.length; index += 1) {
    const value = argv[index]

    if (value === "--dry-run") {
      result.dryRun = true
      continue
    }

    if (value === "--environment") {
      result.environment = argv[index + 1]
      index += 1
      continue
    }

    if (value === "--github-output") {
      result.githubOutput = argv[index + 1]
      index += 1
      continue
    }

    if (value === "--summary-file") {
      result.summaryFile = argv[index + 1]
      index += 1
    }
  }

  if (!["preview", "production"].includes(result.environment)) {
    throw new Error(`Unsupported deployment environment: ${result.environment}`)
  }

  return result
}

function requireEnv(name) {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing ${name}`)
  }
  return value
}

async function runCommand(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
    })

    let stdout = ""
    let stderr = ""

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString("utf8")
      stdout += text
      process.stdout.write(text)
    })

    child.stderr.on("data", (chunk) => {
      const text = chunk.toString("utf8")
      stderr += text
      process.stderr.write(text)
    })

    child.on("exit", (code) => {
      if (code === 0) {
        resolve({ stderr, stdout })
      } else {
        reject(new Error(`${command} ${args.join(" ")} failed in ${options.cwd} with exit code ${code}`))
      }
    })

    child.on("error", reject)
  })
}

function extractDeploymentUrl(output) {
  const matches = output.match(/https:\/\/[^\s]+/gu) ?? []
  return matches.at(-1) ?? null
}

async function hasCommittedProjectLink(example) {
  try {
    await access(`${example.cwd}/.vercel/project.json`)
    return true
  } catch {
    return false
  }
}

async function ensureVercelLink(example, env, token) {
  if (await hasCommittedProjectLink(example)) {
    return
  }

  const args = [
    "exec",
    "vercel",
    "link",
    "--yes",
    `--project=${example.vercelProject}`,
    `--token=${token}`,
  ]

  if (process.env.VERCEL_SCOPE) {
    args.push(`--scope=${process.env.VERCEL_SCOPE}`)
  }

  await runCommand("pnpm", args, { cwd: example.cwd, env })
}

async function logDownloadedProjectSettings(example) {
  try {
    const projectSettingsPath = `${example.cwd}/.vercel/project.json`
    const projectSettings = JSON.parse(await readFile(projectSettingsPath, "utf8"))
    const settings = projectSettings.settings ?? {}
    console.log(
      `[vercel-settings] ${example.id} rootDirectory=${JSON.stringify(settings.rootDirectory ?? null)} buildCommand=${JSON.stringify(settings.buildCommand ?? null)} outputDirectory=${JSON.stringify(settings.outputDirectory ?? null)} framework=${JSON.stringify(settings.framework ?? null)}`
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.log(`[vercel-settings] ${example.id} could not read project settings: ${message}`)
  }
}

async function writeSummaryLine(summaryFile, line) {
  if (!summaryFile) {
    return
  }

  await appendFile(summaryFile, `${line}\n`, "utf8")
}

async function writeGithubOutputs(outputFile, deployment) {
  if (!outputFile) {
    return
  }

  const lines = [
    `deployment_url=${deployment.url}`,
    `public_host=${deployment.publicHost}`,
    `vercel_project=${deployment.vercelProject}`,
    `environment=${deployment.environment}`,
    `example_id=${deployment.id}`,
  ]

  await appendFile(outputFile, `${lines.join("\n")}\n`, "utf8")
}

async function deployExample(example, options) {
  if (options.dryRun) {
    return {
      environment: options.environment,
      id: example.id,
      publicHost: example.publicHost,
      url: `https://${example.publicHost}`,
      vercelProject: example.vercelProject,
    }
  }

  const token = requireEnv("VERCEL_TOKEN")

  const env = {
    ...process.env,
    VERCEL_DISABLE_AUTO_UPDATE: "1",
    VERCEL_TOKEN: token,
  }

  await ensureVercelLink(example, env, token)

  const baseArgs = ["exec", "vercel"]
  const environmentArgs = ["--yes", `--environment=${options.environment}`, `--token=${token}`]
  const buildArgs = ["build", `--token=${token}`]
  const deployArgs = ["deploy", "--prebuilt", "--yes", `--token=${token}`]

  if (options.environment === "production") {
    buildArgs.push("--prod")
    deployArgs.push("--prod")
  }

  console.log(`\n[deploy] ${example.id} -> ${example.vercelProject}`)
  await runCommand("pnpm", [...baseArgs, "pull", ...environmentArgs], { cwd: example.cwd, env })
  await logDownloadedProjectSettings(example)
  await runCommand("pnpm", [...baseArgs, ...buildArgs], { cwd: example.cwd, env })
  const result = await runCommand("pnpm", [...baseArgs, ...deployArgs], { cwd: example.cwd, env })
  const url = extractDeploymentUrl(result.stdout + result.stderr)

  if (!url) {
    throw new Error(`Could not extract deployment URL for ${example.id}`)
  }

  return {
    environment: options.environment,
    id: example.id,
    publicHost: example.publicHost,
    url,
    vercelProject: example.vercelProject,
  }
}

async function main() {
  const options = parseArgs(process.argv)
  const filters = parseExampleArgs(process.argv)
  const selected = selectExamples(filters)

  if (selected.length === 0) {
    throw new Error("No examples matched the provided filters")
  }

  const deployments = []
  for (const example of selected) {
    const deployment = await deployExample(example, options)
    deployments.push(deployment)

    await writeSummaryLine(
      options.summaryFile,
      `- \`${deployment.id}\` -> [${deployment.url}](${deployment.url}) via \`${deployment.vercelProject}\``,
    )
  }

  if (deployments.length === 1) {
    await writeGithubOutputs(options.githubOutput, deployments[0])
  }

  process.stdout.write(`${JSON.stringify(deployments, null, 2)}\n`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
