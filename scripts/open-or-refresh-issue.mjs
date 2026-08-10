// Opens one long-lived tracking issue per title and refreshes it in place, so a
// recurring workflow cannot accumulate a backlog of near-identical reports.
// Shared by the scheduled dependency audit and the release publish lane.
import { spawnSync } from "node:child_process"

const args = process.argv.slice(2)

function option(name) {
  const index = args.indexOf(`--${name}`)
  return index === -1 ? undefined : args[index + 1]
}

const title = option("title")
const bodyFile = option("body-file")
const label = option("label")

if (!title || !bodyFile || !label) {
  console.error(
    "Usage: node ./scripts/open-or-refresh-issue.mjs --title <title> --body-file <path> --label <label>"
  )
  process.exit(1)
}

function gh(commandArgs, options = {}) {
  const result = spawnSync("gh", commandArgs, { encoding: "utf8", ...options })

  if (result.error) {
    console.error(result.error)
    process.exit(1)
  }

  if (result.status !== 0) {
    process.stderr.write(result.stderr ?? "")
    process.exit(result.status ?? 1)
  }

  return (result.stdout ?? "").trim()
}

const existing = gh([
  "issue",
  "list",
  "--state",
  "open",
  "--label",
  label,
  "--search",
  title,
  "--json",
  "number,title",
  "--jq",
  `[.[] | select(.title == ${JSON.stringify(title)})] | first | .number // empty`,
])

if (existing) {
  gh(["issue", "edit", existing, "--body-file", bodyFile], { stdio: "inherit" })
  console.log(`Refreshed issue #${existing}.`)
} else {
  gh(["issue", "create", "--title", title, "--body-file", bodyFile, "--label", label], {
    stdio: "inherit",
  })
}
