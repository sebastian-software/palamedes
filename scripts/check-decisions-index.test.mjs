import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { checkDecisionsIndex } from "./check-decisions-index.mjs";
import { validateDecisionRedirects } from "../site/scripts/decision-redirects.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = new Map();

function read(file) {
  if (!source.has(file)) source.set(file, readFileSync(path.join(root, file), "utf8"));
  return source.get(file);
}

function withMutation(file, mutate) {
  const files = new Map(source);
  files.set(file, mutate(read(file)));
  return (requested) => files.get(requested) ?? read(requested);
}

test("accepts the checked-in ADR index", () => {
  assert.doesNotThrow(() => checkDecisionsIndex({ read }));
});

test("rejects an ADR missing from the index", () => {
  assert.throws(
    () =>
      checkDecisionsIndex({
        read: withMutation("DECISIONS.md", (text) =>
          text.replace(
            "26. [ADR-026: React Router RSC Entry Request Scope](./adr/026-react-router-rsc-entry-request-scope.md)\n",
            "",
          ),
        ),
      }),
    /DECISIONS\.md indexes \d+ ADRs, but adr\/ contains \d+/,
  );
});

test("rejects a valid set of records in the wrong reading order", () => {
  assert.throws(
    () =>
      checkDecisionsIndex({
        read: withMutation("DECISIONS.md", (text) => {
          const first = text.match(/^1\. \[.+$/mu)[0];
          const second = text.match(/^2\. \[.+$/mu)[0];
          return text
            .replace(first, "TEMP_ENTRY")
            .replace(second, first)
            .replace("TEMP_ENTRY", second);
        }),
      }),
    /reading order must be contiguous at ADR-001/u,
  );
});

test("rejects a living record without its last update", () => {
  assert.throws(
    () =>
      checkDecisionsIndex({
        read: withMutation("adr/001-project-scope-and-positioning.md", (text) =>
          text.replace(/^\*\*Last updated:\*\* .+\n/mu, ""),
        ),
      }),
    /must declare its last semantic update/u,
  );
});

test("keeps old URLs attached to their original topics after renumbering", () => {
  const redirects = JSON.parse(read("site/decision-redirects.json"));
  assert.equal(
    redirects["009-typed-napi-boundary-with-workflow-first-native-operations"],
    "017-typed-napi-boundary-with-workflow-first-native-operations",
  );
  assert.equal(redirects["028-effective-flow-project-setup"], "029-effective-flow-project-setup");
});

test("rejects missing redirect targets, chains, and current-page collisions", () => {
  assert.throws(
    () => validateDecisionRedirects({ "001-old": "003-missing" }, ["002-current"]),
    /must target a current record/u,
  );
  assert.throws(
    () =>
      validateDecisionRedirects(
        { "001-old": "002-intermediate", "002-intermediate": "003-current" },
        ["003-current"],
      ),
    /must target a current record/u,
  );
  assert.throws(
    () => validateDecisionRedirects({ "001-current": "002-other" }, ["001-current", "002-other"]),
    /shadows a current record/u,
  );
});

test("rejects a title that does not match its ADR heading", () => {
  assert.throws(
    () =>
      checkDecisionsIndex({
        read: withMutation("DECISIONS.md", (text) =>
          text.replace("Host Explicit Binary CLI Plugins In Rust", "Host Plugins in npm"),
        ),
      }),
    /DECISIONS\.md title for adr\/015-cli-plugin-execution-boundary\.md must match its ADR heading/,
  );
});
