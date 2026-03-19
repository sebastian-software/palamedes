import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"

export const DEFAULT_SEED = 20260318

export const PROFILE_DEFINITIONS = {
  small: {
    fileCount: 100,
  },
  medium: {
    fileCount: 400,
  },
  large: {
    fileCount: 1200,
  },
}

const FIXTURE_MESSAGES_PER_FILE = 10

const AREAS = [
  "queue",
  "board",
  "campaign",
  "ledger",
  "insight",
  "portal",
  "workspace",
  "release",
]

const ACTIONS = [
  "review",
  "approve",
  "sync",
  "publish",
  "triage",
  "archive",
  "ship",
  "stage",
]

const SURFACES = [
  "toolbar",
  "modal",
  "sidebar",
  "header",
  "panel",
  "summary",
  "overview",
  "detail",
]

const STATUSES = ["draft", "published", "scheduled", "queued"]
const DEFAULT_LOCALES = ["en", "de"]

export async function createSyntheticProfile({ profileName, rootDir, seed = DEFAULT_SEED }) {
  const profile = PROFILE_DEFINITIONS[profileName]

  if (!profile) {
    throw new Error(`Unknown benchmark profile: ${profileName}`)
  }

  const profileRoot = path.join(rootDir, profileName)
  const localeRoot = path.join(profileRoot, "src", "locales")
  const files = []
  const manifest = []

  await mkdir(localeRoot, { recursive: true })

  for (let fileIndex = 0; fileIndex < profile.fileCount; fileIndex += 1) {
    const isTsx = fileIndex % 4 !== 0
    const relativePath = path.join(
      "src",
      "generated",
      `group-${padNumber(Math.floor(fileIndex / 50), 2)}`,
      `fixture-${padNumber(fileIndex, 4)}.${isTsx ? "tsx" : "ts"}`
    )
    const absolutePath = path.join(profileRoot, relativePath)
    const fixture = isTsx
      ? createTsxFixture(fileIndex, relativePath, seed)
      : createTsFixture(fileIndex, relativePath, seed)

    if (fixture.entries.length !== FIXTURE_MESSAGES_PER_FILE) {
      throw new Error(
        `Fixture ${relativePath} produced ${fixture.entries.length} messages, expected ${FIXTURE_MESSAGES_PER_FILE}`
      )
    }

    await mkdir(path.dirname(absolutePath), { recursive: true })
    await writeFile(absolutePath, fixture.source, "utf8")

    files.push({
      filename: absolutePath,
      relativePath,
      kind: isTsx ? "tsx" : "ts",
      source: fixture.source,
      sourceBytes: Buffer.byteLength(fixture.source),
      expectedKeys: fixture.entries.map((entry) => createMessageKey(entry.message, entry.context)),
    })

    for (const entry of fixture.entries) {
      manifest.push({
        ...entry,
        file: relativePath,
      })
    }
  }

  const localeFiles = {}
  for (const locale of DEFAULT_LOCALES) {
    const content = renderPo(locale, manifest)
    const filename = path.join(localeRoot, `${locale}.po`)
    await writeFile(filename, content, "utf8")
    localeFiles[locale] = {
      filename,
      bytes: Buffer.byteLength(content),
    }
  }

  return {
    profileName,
    rootDir: profileRoot,
    seed,
    files,
    manifest,
    fileCount: files.length,
    messageCount: manifest.length,
    sourceBytes: files.reduce((sum, file) => sum + file.sourceBytes, 0),
    localeFiles,
    locales: [...DEFAULT_LOCALES],
    sourceLocale: "en",
  }
}

export function createMessageKey(message, context) {
  return `${context ?? ""}\u0004${message}`
}

function createTsxFixture(fileIndex, relativePath, seed) {
  const text = createFixtureText(fileIndex, seed)
  const positionLabel = fileIndex % 2 === 0 ? "SelectOrdinal" : "Select"
  const imports = [
    'import { defineMessage, msg, plural, select, selectOrdinal, t } from "@lingui/core/macro"',
    `import { Plural, ${positionLabel}, Trans } from "@lingui/react/macro"`,
  ]
  const entries = [
    makeEntry(
      `Welcome {accountName} to ${text.area} ${tokenFor(fileIndex, 1)}`,
      undefined,
      `const message01 = t\`Welcome \${accountName} to ${text.area} ${tokenFor(fileIndex, 1)}\``
    ),
    makeEntry(
      `Batch {taskCount} hit ${text.action} ${tokenFor(fileIndex, 2)}`,
      undefined,
      `const message02 = msg\`Batch \${taskCount} hit ${text.action} ${tokenFor(fileIndex, 2)}\``
    ),
    makeEntry(
      `Open ${text.surface} ${tokenFor(fileIndex, 3)}`,
      undefined,
      `const message03 = defineMessage({ message: "Open ${text.surface} ${tokenFor(fileIndex, 3)}" })`
    ),
    makeEntry(
      `Save ${text.area} ${tokenFor(fileIndex, 4)}`,
      "toolbar",
      `const message04 = t({ message: "Save ${text.area} ${tokenFor(fileIndex, 4)}", context: "toolbar" })`
    ),
    makeEntry(
      `{taskCount, plural, one {# ${text.area} ${tokenFor(fileIndex, 5)}} other {# ${text.areaPlural} ${tokenFor(fileIndex, 5)}}}`,
      undefined,
      `const message05 = plural(taskCount, { one: "# ${text.area} ${tokenFor(fileIndex, 5)}", other: "# ${text.areaPlural} ${tokenFor(fileIndex, 5)}" })`
    ),
    makeEntry(
      `{status, select, draft {Draft ${text.action} ${tokenFor(fileIndex, 6)}} published {Published ${text.action} ${tokenFor(fileIndex, 6)}} other {Fallback ${text.action} ${tokenFor(fileIndex, 6)}}}`,
      undefined,
      `const message06 = select(status, { draft: "Draft ${text.action} ${tokenFor(fileIndex, 6)}", published: "Published ${text.action} ${tokenFor(fileIndex, 6)}", other: "Fallback ${text.action} ${tokenFor(fileIndex, 6)}" })`
    ),
    makeEntry(
      `{position, selectordinal, one {#st ${text.surface} ${tokenFor(fileIndex, 7)}} two {#nd ${text.surface} ${tokenFor(fileIndex, 7)}} few {#rd ${text.surface} ${tokenFor(fileIndex, 7)}} other {#th ${text.surface} ${tokenFor(fileIndex, 7)}}}`,
      undefined,
      `const message07 = selectOrdinal(position, { one: "#st ${text.surface} ${tokenFor(fileIndex, 7)}", two: "#nd ${text.surface} ${tokenFor(fileIndex, 7)}", few: "#rd ${text.surface} ${tokenFor(fileIndex, 7)}", other: "#th ${text.surface} ${tokenFor(fileIndex, 7)}" })`
    ),
    makeEntry(
      `Approve <0>${text.area} ${tokenFor(fileIndex, 8)}</0>`,
      undefined,
      `<p><Trans>Approve <strong>${text.area} ${tokenFor(fileIndex, 8)}</strong></Trans></p>`
    ),
    makeEntry(
      `{taskCount, plural, one {# alert ${tokenFor(fileIndex, 9)}} other {# alerts ${tokenFor(fileIndex, 9)}}}`,
      undefined,
      `<p><Plural value={taskCount} one="# alert ${tokenFor(fileIndex, 9)}" other="# alerts ${tokenFor(fileIndex, 9)}" /></p>`
    ),
    fileIndex % 2 === 0
      ? makeEntry(
          `{position, selectordinal, one {#st checkpoint ${tokenFor(fileIndex, 10)}} two {#nd checkpoint ${tokenFor(fileIndex, 10)}} few {#rd checkpoint ${tokenFor(fileIndex, 10)}} other {#th checkpoint ${tokenFor(fileIndex, 10)}}}`,
          undefined,
          `<p><SelectOrdinal value={position} one="#st checkpoint ${tokenFor(fileIndex, 10)}" two="#nd checkpoint ${tokenFor(fileIndex, 10)}" few="#rd checkpoint ${tokenFor(fileIndex, 10)}" other="#th checkpoint ${tokenFor(fileIndex, 10)}" /></p>`
        )
      : makeEntry(
          `Plan <0>${text.surface} ${tokenFor(fileIndex, 10)}</0>`,
          "sidebar",
          `<p><Trans context="sidebar">Plan <em>${text.surface} ${tokenFor(fileIndex, 10)}</em></Trans></p>`
        ),
  ]

  const source = [
    ...imports,
    "",
    `export function Fixture${padNumber(fileIndex, 4)}() {`,
    `  const accountName = "account-${padNumber(fileIndex, 4)}"`,
    `  const taskCount = ${(fileIndex % 5) + 2}`,
    `  const status = "${STATUSES[fileIndex % STATUSES.length]}"`,
    `  const position = ${(fileIndex % 4) + 1}`,
    "",
    `  ${entries[0].sourceLine}`,
    `  ${entries[1].sourceLine}`,
    `  ${entries[2].sourceLine}`,
    `  ${entries[3].sourceLine}`,
    `  ${entries[4].sourceLine}`,
    `  ${entries[5].sourceLine}`,
    `  ${entries[6].sourceLine}`,
    "",
    "  void message01",
    "  void message02",
    "  void message03",
    "  void message04",
    "  void message05",
    "  void message06",
    "  void message07",
    "",
    "  return (",
    `    <section data-benchmark="${path.basename(relativePath)}">`,
    `      ${entries[7].sourceLine}`,
    `      ${entries[8].sourceLine}`,
    `      ${entries[9].sourceLine}`,
    "    </section>",
    "  )",
    "}",
    "",
  ].join("\n")

  return {
    source,
    entries: entries.map(toManifestEntry),
  }
}

function createTsFixture(fileIndex, relativePath, seed) {
  const text = createFixtureText(fileIndex, seed)
  const entries = [
    makeEntry(
      `Queue {accountName} for ${text.area} ${tokenFor(fileIndex, 1)}`,
      undefined,
      `const message01 = t\`Queue \${accountName} for ${text.area} ${tokenFor(fileIndex, 1)}\``
    ),
    makeEntry(
      `Sync {taskCount} ${text.areaPlural} in ${text.surface} ${tokenFor(fileIndex, 2)}`,
      undefined,
      `const message02 = msg\`Sync \${taskCount} ${text.areaPlural} in ${text.surface} ${tokenFor(fileIndex, 2)}\``
    ),
    makeEntry(
      `Archive ${text.area} ${tokenFor(fileIndex, 3)}`,
      undefined,
      `const message03 = defineMessage({ message: "Archive ${text.area} ${tokenFor(fileIndex, 3)}" })`
    ),
    makeEntry(
      `Confirm ${text.surface} ${tokenFor(fileIndex, 4)}`,
      "modal",
      `const message04 = t({ message: "Confirm ${text.surface} ${tokenFor(fileIndex, 4)}", context: "modal" })`
    ),
    makeEntry(
      `{taskCount, plural, one {# ${text.action} ${tokenFor(fileIndex, 5)}} other {# ${text.actionPlural} ${tokenFor(fileIndex, 5)}}}`,
      undefined,
      `const message05 = plural(taskCount, { one: "# ${text.action} ${tokenFor(fileIndex, 5)}", other: "# ${text.actionPlural} ${tokenFor(fileIndex, 5)}" })`
    ),
    makeEntry(
      `{status, select, draft {Draft ${text.surface} ${tokenFor(fileIndex, 6)}} published {Published ${text.surface} ${tokenFor(fileIndex, 6)}} other {Fallback ${text.surface} ${tokenFor(fileIndex, 6)}}}`,
      undefined,
      `const message06 = select(status, { draft: "Draft ${text.surface} ${tokenFor(fileIndex, 6)}", published: "Published ${text.surface} ${tokenFor(fileIndex, 6)}", other: "Fallback ${text.surface} ${tokenFor(fileIndex, 6)}" })`
    ),
    makeEntry(
      `{position, selectordinal, one {#st rank ${tokenFor(fileIndex, 7)}} two {#nd rank ${tokenFor(fileIndex, 7)}} few {#rd rank ${tokenFor(fileIndex, 7)}} other {#th rank ${tokenFor(fileIndex, 7)}}}`,
      undefined,
      `const message07 = selectOrdinal(position, { one: "#st rank ${tokenFor(fileIndex, 7)}", two: "#nd rank ${tokenFor(fileIndex, 7)}", few: "#rd rank ${tokenFor(fileIndex, 7)}", other: "#th rank ${tokenFor(fileIndex, 7)}" })`
    ),
    makeEntry(
      `Review {accountName} inside ${text.surface} ${tokenFor(fileIndex, 8)}`,
      undefined,
      `const message08 = t\`Review \${accountName} inside ${text.surface} ${tokenFor(fileIndex, 8)}\``
    ),
    makeEntry(
      `Open ${text.area} ${tokenFor(fileIndex, 9)}`,
      "sidebar",
      `const message09 = defineMessage({ message: "Open ${text.area} ${tokenFor(fileIndex, 9)}", context: "sidebar" })`
    ),
    makeEntry(
      `Stage {taskCount} ${text.areaPlural} for ${text.action} ${tokenFor(fileIndex, 10)}`,
      undefined,
      `const message10 = msg\`Stage \${taskCount} ${text.areaPlural} for ${text.action} ${tokenFor(fileIndex, 10)}\``
    ),
  ]

  const source = [
    'import { defineMessage, msg, plural, select, selectOrdinal, t } from "@lingui/core/macro"',
    "",
    `export function buildFixture${padNumber(fileIndex, 4)}() {`,
    `  const accountName = "account-${padNumber(fileIndex, 4)}"`,
    `  const taskCount = ${(fileIndex % 5) + 2}`,
    `  const status = "${STATUSES[fileIndex % STATUSES.length]}"`,
    `  const position = ${(fileIndex % 4) + 1}`,
    "",
    `  ${entries[0].sourceLine}`,
    `  ${entries[1].sourceLine}`,
    `  ${entries[2].sourceLine}`,
    `  ${entries[3].sourceLine}`,
    `  ${entries[4].sourceLine}`,
    `  ${entries[5].sourceLine}`,
    `  ${entries[6].sourceLine}`,
    `  ${entries[7].sourceLine}`,
    `  ${entries[8].sourceLine}`,
    `  ${entries[9].sourceLine}`,
    "",
    "  return [",
    "    message01,",
    "    message02,",
    "    message03,",
    "    message04,",
    "    message05,",
    "    message06,",
    "    message07,",
    "    message08,",
    "    message09,",
    "    message10,",
    "  ].length",
    "}",
    "",
  ].join("\n")

  return {
    source,
    entries: entries.map(toManifestEntry),
  }
}

function createFixtureText(fileIndex, seed) {
  const area = pick(AREAS, seed, fileIndex, 0)
  const action = pick(ACTIONS, seed, fileIndex, 1)
  const surface = pick(SURFACES, seed, fileIndex, 2)

  return {
    area,
    action,
    surface,
    areaPlural: `${area}s`,
    actionPlural: `${action}s`,
  }
}

function renderPo(locale, manifest) {
  const lines = [
    'msgid ""',
    'msgstr ""',
    `"Language: ${locale}\\n"`,
    '"Content-Type: text/plain; charset=utf-8\\n"',
    '"Content-Transfer-Encoding: 8bit\\n"',
    '"X-Generator: palamedes-lingui-v6-benchmark\\n"',
    "",
  ]

  for (const entry of manifest) {
    lines.push(`#: ${entry.file}`)
    if (entry.context) {
      lines.push(`msgctxt ${quotePo(entry.context)}`)
    }
    lines.push(`msgid ${quotePo(entry.message)}`)
    lines.push(`msgstr ${quotePo(entry.message)}`)
    lines.push("")
  }

  return lines.join("\n")
}

function makeEntry(message, context, sourceLine) {
  return { message, context, sourceLine }
}

function toManifestEntry(entry) {
  return {
    message: entry.message,
    context: entry.context,
  }
}

function quotePo(value) {
  return `"${value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")}"`
}

function pick(values, seed, fileIndex, salt) {
  const index = Math.abs(numberHash(seed + fileIndex * 17 + salt * 31)) % values.length
  return values[index]
}

function numberHash(value) {
  let state = value >>> 0
  state ^= state << 13
  state ^= state >>> 17
  state ^= state << 5
  return state | 0
}

function tokenFor(fileIndex, entryIndex) {
  return `${padNumber(fileIndex, 4)}-${padNumber(entryIndex, 2)}`
}

function padNumber(value, width) {
  return String(value).padStart(width, "0")
}
