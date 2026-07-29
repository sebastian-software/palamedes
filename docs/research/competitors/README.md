# Open-source client and framework comparisons

This directory contains technical research that is appropriate for the public
Palamedes repository: genuinely open-source client libraries, framework
adapters, runtimes, compilers, and extraction tooling.

## Boundary

A dossier may live here only when all of the following are true:

1. `subject` is a client-side framework, SDK, runtime, compiler, or extraction
   tool that can be evaluated independently of an account-bound service.
2. The analyzed source is distributed under an OSI-approved license.
3. The content is technical. Company, funding, market, pricing, hosted-service,
   TMS, AI-service, and commercial-platform comparisons belong in the private
   `palamedes-plus/docs/research/commercial` directory.

Hybrid vendors are split by analyzed subject, not by company. The MIT-licensed
Tolgee JS SDK can therefore be discussed here, while Tolgee's platform,
hosting, pricing, and enterprise model stay in Plus. General Translation does
not appear here because its SDK is source-available under the Functional Source
License rather than open source.

## Required metadata

Every dossier (other than an index README) records:

```yaml
scope: oss-client-framework
subject: <specific client or framework surface>
license: <SPDX identifier or an explicit multi-license value>
analyzed: YYYY-MM-DD
analyzed_versions: "<exact versions or source snapshot>"
```

`scope`, `subject`, and `license` are the machine-readable repository-boundary
contract. Re-verify time-sensitive facts before citing a dossier.

## Research

- [Framework and client comparison](frameworks/README.md)
- Individual sourced dossiers under [`frameworks/`](frameworks/)

Commercial research was migrated to the private Palamedes+ repository on
2026-07-29. Git history and the accepted repository archives preserve the old
public locations.
