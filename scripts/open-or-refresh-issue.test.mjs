import assert from "node:assert/strict";
import test from "node:test";

import { manageTrackingIssue } from "./open-or-refresh-issue.mjs";

const title = "chore(release): publish workflow failed";
const label = "type:bug";

test("refreshes the exact tracking issue without using GitHub search syntax", () => {
  const calls = [];

  manageTrackingIssue(["--title", title, "--body-file", "issue-body.md", "--label", label], {
    log() {},
    runGh(args, options) {
      calls.push({ args, options });
      return calls.length === 1
        ? JSON.stringify([
            { number: 1113, title },
            { number: 999, title: `${title} again` },
          ])
        : "";
    },
  });

  assert.deepEqual(calls[0], {
    args: ["issue", "list", "--state", "open", "--limit", "1000", "--json", "number,title"],
    options: undefined,
  });
  assert.deepEqual(calls[1], {
    args: ["issue", "edit", "1113", "--body-file", "issue-body.md"],
    options: { stdio: "inherit" },
  });
});

test("closes every exact duplicate and leaves similar issue titles open", () => {
  const calls = [];

  manageTrackingIssue(
    ["--title", title, "--label", label, "--close-comment", "The release completed successfully."],
    {
      log() {},
      runGh(args, options) {
        calls.push({ args, options });
        return calls.length === 1
          ? JSON.stringify([
              { number: 1113, title },
              { number: 1078, title },
              { number: 1073, title },
              { number: 718, title: "chore(release): publish workflow failed again" },
              { number: 42, title: "chore(deps): dependency audit findings" },
            ])
          : "";
      },
    },
  );

  assert.deepEqual(
    calls.slice(1).map(({ args }) => args),
    [
      ["issue", "close", "1113", "--comment", "The release completed successfully."],
      ["issue", "close", "1078", "--comment", "The release completed successfully."],
      ["issue", "close", "1073", "--comment", "The release completed successfully."],
    ],
  );
});

test("creates a tracking issue only when no exact title exists", () => {
  const calls = [];

  manageTrackingIssue(["--title", title, "--body-file", "issue-body.md", "--label", label], {
    log() {},
    runGh(args, options) {
      calls.push({ args, options });
      return calls.length === 1 ? JSON.stringify([{ number: 999, title: `${title} again` }]) : "";
    },
  });

  assert.deepEqual(calls[1], {
    args: ["issue", "create", "--title", title, "--body-file", "issue-body.md", "--label", label],
    options: { stdio: "inherit" },
  });
});
