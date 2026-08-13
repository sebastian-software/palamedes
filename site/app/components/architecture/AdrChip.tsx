import { decisionHref } from "~/data/links"

const ADR_SLUGS: Record<string, string> = {
  "002": "002-rust-first-core-with-thin-host-adapters",
  "003": "003-source-string-first-message-identity",
  "008": "008-framework-adapter-architecture",
  "009": "009-typed-napi-boundary-with-workflow-first-native-operations",
  "013": "013-bounded-parallel-extraction",
  "019": "019-extraction-cache",
  "020": "020-locale-is-fixed-for-a-browser-document",
  "022": "022-generated-catalogs-use-executable-message-functions",
  "023": "023-generated-production-runtime-is-parser-free",
}

export function AdrChip({ number }: { number: string }) {
  const slug = ADR_SLUGS[number]
  if (!slug) throw new Error(`Missing architecture ADR slug for ${number}`)

  return (
    <a
      href={decisionHref(slug)}
      className="micro inline-flex border border-hair px-2 py-1 text-[10px] tracking-label text-accent hover:border-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      ADR-{number}
    </a>
  )
}
