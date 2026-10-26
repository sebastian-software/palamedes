import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { checkReadmeInformationArchitecture } from "./check-readme-ia.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const readme = readFileSync(join(root, "README.md"), "utf8");

function check(markdown, exists = existsSync) {
  return () =>
    checkReadmeInformationArchitecture({
      read: (file) => (file === "README.md" ? markdown : readFileSync(join(root, file), "utf8")),
      exists,
    });
}

test("accepts the checked-in README information architecture", () => {
  assert.doesNotThrow(check(readme));
});

test("requires website paths for setup and evaluation", () => {
  assert.throws(
    check(
      readme.replaceAll(
        "https://palamedes.dev/docs/first-working-translation",
        "https://example.com",
      ),
    ),
    /missing website path/u,
  );
});

test("requires linked badges for every usable public npm package", () => {
  assert.throws(
    check(readme.replace("%40palamedes%2Fcore)", "%40palamedes%2Fmissing)")),
    /missing linked npm v badge: @palamedes\/core/u,
  );
  assert.throws(
    check(readme.replace("npm/dm/%40palamedes%2Fcli", "npm/dm/%40palamedes%2Fmissing")),
    /missing linked npm dm badge: @palamedes\/cli/u,
  );
  assert.throws(
    check(readme.replace("(packages/config/README.md)", "(packages/missing/README.md)")),
    /missing package README link: @palamedes\/config/u,
  );
});

test("rejects broken repository links and anchors", () => {
  assert.throws(
    check(`${readme}\n[Missing guide](docs/missing-quickstart.md)\n`),
    /missing repository path/,
  );
  assert.throws(check(`${readme}\n[Missing section](#missing-proof)\n`), /missing anchor/);
});

test("ignores headings and links inside GFM fenced code blocks", () => {
  const fencedOnlyIntegrations = `${readme.replace("## Integrations", "## Hosts")}
\n~~~markdown
## Integrations
[Missing guide](docs/missing-from-fence.md)
~~~
`;
  assert.throws(check(fencedOnlyIntegrations), /missing Integrations/u);

  assert.doesNotThrow(
    check(`${readme}
\n\`\`\`markdown
[Missing guide](docs/missing-from-fence.md)
\`\`\`
`),
  );
});

test("does not accept a fenced heading as a GitHub anchor", () => {
  assert.throws(
    check(`${readme}\n\`\`\`yaml\n# palamedes.yaml\n\`\`\`\n[Ghost](#palamedesyaml)\n`),
    /missing anchor/u,
  );
});

test("matches GitHub duplicate-heading suffixes", () => {
  assert.doesNotThrow(
    check(`${readme}
\n### Repeated
### Repeated
[Second repeated heading](#repeated-1)
`),
  );
});

test("matches GitHub rendered heading text and global slug collisions", () => {
  const headings = `${readme}

### Under_score
### [Linked](https://example.com)
### Collision
### Collision-1
### Collision
[Underscore](#under_score)
[Rendered link text](#linked)
[Collision after an explicit suffix](#collision-2)
`;

  assert.doesNotThrow(check(headings));
  assert.throws(check(`${headings}\n[Wrong underscore](#underscore)\n`), /missing anchor/u);
  assert.throws(
    check(`${headings}\n[Wrong source-derived link](#linkedhttpsexamplecom)\n`),
    /missing anchor/u,
  );
});

test("removes underscore emphasis without losing literal or code underscores", () => {
  const headings = `${readme}

### _Italic_
### __Strong__
### Under_score
### \`_Code_\`
### \`\` _Spaced_ \`\`
[Italic](#italic)
[Strong](#strong)
[Literal underscore](#under_score)
[Code underscore](#_code_)
[Spaced code underscore](#_spaced_)
`;

  assert.doesNotThrow(check(headings));
  assert.throws(check(`${headings}\n[Source italic](#_italic_)\n`), /missing anchor/u);
  assert.throws(check(`${headings}\n[Source strong](#__strong__)\n`), /missing anchor/u);
  assert.throws(check(`${headings}\n[Stripped code](#spaced)\n`), /missing anchor/u);
});

test("parses emphasis between escaped literal backticks", () => {
  const escapedBackticks = `${readme}

${"### \\`_Not code_\\`"}
[Rendered emphasis](#not-code)
`;

  assert.doesNotThrow(check(escapedBackticks));
  assert.throws(check(`${escapedBackticks}\n[Source emphasis](#_not-code_)\n`), /missing anchor/u);
});

test("requires company branding and rejects legacy markers", () => {
  assert.throws(
    check(`${readme}\n[More from Ferramenta](https://ferramenta.dev)\n`),
    /cross-promotion/u,
  );
  assert.throws(
    check(`${readme}\n<!-- ferramenta-family:start -->\n`),
    /legacy generated markers/u,
  );
  assert.throws(
    check(readme.replace("logo-software.svg", "other.svg")),
    /expected Sebastian Software/u,
  );
});

test("keeps project prose above the company footer", () => {
  assert.throws(
    check(`${readme}\n## Afterword\n\nOne more thing.\n`),
    /project sections must precede/u,
  );
});

test("keeps the company badge below the project title", () => {
  const badge = readme.match(/\[!\[Powered by Sebastian Software\]\([^\n]+?\)\]\([^\n]+?\)/u)?.[0];
  assert.ok(badge);
  const moved = readme.replace(badge, "").replace("# Palamedes", `${badge}\n\n# Palamedes`);
  assert.throws(check(moved), /expected Sebastian Software/u);
});
