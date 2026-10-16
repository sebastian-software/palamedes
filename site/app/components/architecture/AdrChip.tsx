import { decisionHref } from "~/data/links";

const ADR_SLUGS: Record<string, string> = {
  "002": "002-rust-first-core-with-thin-host-adapters",
  "003": "003-source-string-first-message-identity",
  "006": "006-universal-geti18n-runtime-model",
  "009": "009-ferrocat-as-catalog-and-icu-foundation",
  "013": "013-native-boundary-and-distribution",
  "008": "008-framework-adapter-architecture",
  "017": "017-typed-napi-boundary-with-workflow-first-native-operations",
  "018": "018-generated-typescript-types-derived-from-the-native-binding-surface",
  "019": "019-native-catalog-rendering-produces-bundler-modules",
  "023": "023-bounded-parallel-extraction",
  "024": "024-native-transform-source-maps",
  "021": "021-runtime-formatter-subset-diagnostics",
  "022": "022-extraction-cache",
  "007": "007-locale-is-fixed-for-a-browser-document",
  "004": "004-generated-catalogs-use-executable-message-functions",
  "005": "005-generated-production-runtime-is-parser-free",
  "026": "026-react-router-rsc-entry-request-scope",
  "011": "011-editorial-visual-brand-system",
};

export function AdrChip({ number }: { number: string }) {
  const slug = ADR_SLUGS[number];
  if (!slug) throw new Error(`Missing architecture ADR slug for ${number}`);

  return (
    <a
      href={decisionHref(slug)}
      className="micro inline-flex border border-hair px-2 py-1 text-[10px] tracking-label text-accent hover:border-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      ADR-{number}
    </a>
  );
}
