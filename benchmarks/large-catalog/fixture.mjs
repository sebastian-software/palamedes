const DEFAULT_MESSAGE_COUNT = 10_000
const DEFAULT_SOURCE_FILE_COUNT = 20

const SUBJECTS = [
  "shipment",
  "invoice",
  "approval",
  "task",
  "review",
  "order",
  "customer",
  "handoff",
]

const AREAS = [
  "dashboard",
  "inbox",
  "workflow",
  "timeline",
  "settings",
  "notifications",
  "reporting",
  "audit",
]

export function createLargeCatalogFixture(options = {}) {
  const messageCount = normalizePositiveInteger(options.messageCount, DEFAULT_MESSAGE_COUNT)
  const sourceFileCount = normalizePositiveInteger(options.sourceFileCount, DEFAULT_SOURCE_FILE_COUNT)
  const messages = []
  const sourceFiles = Array.from({ length: sourceFileCount }, (_, index) => ({
    filename: `benchmarks/large-catalog/generated/part-${String(index + 1).padStart(3, "0")}.tsx`,
    lines: [
      'import { t } from "@palamedes/react/macro"',
      "",
      "export function renderMessages(count: number, name: string, status: string) {",
      "  return [",
    ],
  }))

  for (let index = 0; index < messageCount; index += 1) {
    const sourceFile = sourceFiles[index % sourceFileCount]
    const message = createMessage(index)
    const context = index % 7 === 0 ? `${AREAS[index % AREAS.length]}.panel` : undefined

    messages.push({
      message,
      context,
      extractedComments: [`Synthetic large-catalog benchmark message ${index + 1}`],
      origins: [
        {
          file: sourceFile.filename,
          line: sourceFile.lines.length + 1,
        },
      ],
    })

    const descriptor = context ? `{ message: ${JSON.stringify(message)}, context: ${JSON.stringify(context)} }` : `{ message: ${JSON.stringify(message)} }`
    sourceFile.lines.push(`    t(${descriptor}, { count, name, status }),`)
  }

  for (const sourceFile of sourceFiles) {
    sourceFile.lines.push("  ]")
    sourceFile.lines.push("}")
  }

  return {
    messageCount,
    sourceFileCount,
    messages,
    fixtures: sourceFiles.map((sourceFile) => ({
      filename: sourceFile.filename,
      source: `${sourceFile.lines.join("\n")}\n`,
    })),
  }
}

function createMessage(index) {
  const subject = SUBJECTS[index % SUBJECTS.length]
  const area = AREAS[index % AREAS.length]
  const id = String(index + 1).padStart(5, "0")

  switch (index % 5) {
    case 0:
      return `Benchmark ${area} ${id}: ${subject} assigned to {name}`
    case 1:
      return `Benchmark ${area} ${id}: {count, plural, one {# ${subject}} other {# ${subject}s}} ready`
    case 2:
      return `Benchmark ${area} ${id}: status is {status, select, open {open} closed {closed} other {unknown}}`
    case 3:
      return `Benchmark ${area} ${id}: {count, plural, =0 {no ${subject}s} one {one ${subject}} other {# ${subject}s}} for {name}`
    default:
      return `Benchmark ${area} ${id}: review ${subject} with <strong>{name}</strong>`
  }
}

function normalizePositiveInteger(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback
}
