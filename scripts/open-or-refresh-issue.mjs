// Opens one long-lived tracking issue per title and refreshes it in place, so a
// recurring workflow cannot accumulate a backlog of near-identical reports.
// Shared by the scheduled dependency audit and the release publish lane.
import { spawnSync } from "node:child_process";
import path from "node:path";

const usage =
  "Usage: node ./scripts/open-or-refresh-issue.mjs --title <title> --label <label> (--body-file <path> | --close-comment <comment>)";

function option(args, name) {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? undefined : args[index + 1];
}

export function manageTrackingIssue(args, { log = console.log, runGh = gh } = {}) {
  const title = option(args, "title");
  const bodyFile = option(args, "body-file");
  const closeComment = option(args, "close-comment");
  const label = option(args, "label");

  if (!title || !label || Boolean(bodyFile) === Boolean(closeComment)) {
    throw new Error(usage);
  }

  const openIssues = JSON.parse(
    runGh(["issue", "list", "--state", "open", "--limit", "1000", "--json", "number,title"]),
  );

  if (!Array.isArray(openIssues)) {
    throw new TypeError("GitHub returned an invalid issue list.");
  }

  const matches = openIssues.filter(
    (issue) =>
      issue &&
      Number.isInteger(issue.number) &&
      typeof issue.title === "string" &&
      issue.title === title,
  );

  if (closeComment) {
    for (const issue of matches) {
      runGh(["issue", "close", String(issue.number), "--comment", closeComment], {
        stdio: "inherit",
      });
    }

    if (matches.length > 0) {
      log(`Closed ${matches.length} tracking issue(s) titled ${JSON.stringify(title)}.`);
    }
    return;
  }

  const existing = matches[0];
  if (existing) {
    runGh(["issue", "edit", String(existing.number), "--body-file", bodyFile], {
      stdio: "inherit",
    });
    log(`Refreshed issue #${existing.number}.`);
  } else {
    runGh(["issue", "create", "--title", title, "--body-file", bodyFile, "--label", label], {
      stdio: "inherit",
    });
  }
}

function gh(commandArgs, options = {}) {
  const result = spawnSync("gh", commandArgs, { encoding: "utf8", ...options });

  if (result.error) {
    console.error(result.error);
    process.exit(1);
  }

  if (result.status !== 0) {
    process.stderr.write(result.stderr ?? "");
    process.exit(result.status ?? 1);
  }

  return (result.stdout ?? "").trim();
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  try {
    manageTrackingIssue(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
