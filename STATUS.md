# Palamedes Status

**Last updated:** 2026-03-10
**Branch:** `main`
**HEAD:** `9de22c4` (`refactor: rename package surface to palamedes`)
**Worktree before this document:** dirty during active follow-up work

## Summary

Der Branch hat den ersten größeren Umbau von Palamedes auf ein Rust-Core-Modell bereits gestartet.

Im aktuellen Stand sind Rust-Workspace, Node-Bindings, `pofile`-Integration, ein nativer Extractor, ein erweiterter nativer Transform-Slice, das neue `getI18n()`-Runtime-Modell, die `pnpm`-Migration, die reparierte Next-Loader-Auslieferung und die Umbenennung der öffentlichen Paketoberfläche auf Palamedes-Namen umgesetzt.

Die größten offenen Baustellen liegen jetzt nicht mehr bei der Grundarchitektur, sondern bei Parität und Aufräumen: vollständige Rust-Transform-Abdeckung, Sourcemaps, Entfernen alter Kompatibilitätspfade und native Distribution.

## Was erledigt ist

### Architektur und Entscheidungen

- Rust-Core-Zielbild dokumentiert: [docs/plans/2026-03-09-palamedes-rust-core-design.md](/Users/sebastian/Workspace/business/palamedes/docs/plans/2026-03-09-palamedes-rust-core-design.md)
- ADR-Struktur auf einzelne Dateien unter [adr/](/Users/sebastian/Workspace/business/palamedes/adr) umgestellt
- Zentrale ADRs ergänzt:
  - [ADR-011 Rust Core with Thin Node/TypeScript Wrappers](/Users/sebastian/Workspace/business/palamedes/adr/011-rust-core-with-thin-node-typescript-wrappers.md)
  - [ADR-012 Native Node Bindings via napi-rs](/Users/sebastian/Workspace/business/palamedes/adr/012-native-node-bindings-via-napi-rs.md)
  - [ADR-013 Hybrid Native Extractor Rollout](/Users/sebastian/Workspace/business/palamedes/adr/013-hybrid-native-extractor-rollout.md)
  - [ADR-014 Universal `getI18n()` Runtime Primitive](/Users/sebastian/Workspace/business/palamedes/adr/014-universal-geti18n-runtime-primitive.md)

### Rust-Core und Bindings

- Cargo-Workspace eingeführt
- `crates/palamedes` als Rust-Core angelegt
- `crates/palamedes-node` als Node-Binding-Crate angelegt
- `packages/core-node` als dünner TS-Wrapper über die native `.node`-Bindung angelegt
- `pofile` auf die veröffentlichte Beta umgestellt: `5.0.0-beta.0`

### Native Foundation APIs

Aktuell aus Rust bzw. über `@palamedes/core-node` verfügbar:

- `generateMessageId`
- `parsePo`
- `getNativeInfo`
- `extractMessagesNative`
- `transformMacrosNative`

### Extractor

- Der Extractor läuft jetzt standardmäßig über Rust
- Die bestehende Extractor-Test-Suite läuft grün
- Abgedeckt sind inzwischen:
  - Tagged Templates wie `t\`...\`` und `msg\`...\``
  - Descriptor-Calls wie `t({...})`, `msg({...})`, `defineMessage({...})`
  - Runtime-Calls wie `i18n._(...)`
  - JSX-Makros wie `<Trans>`, `<Plural>`, `<Select>`, `<SelectOrdinal>`
  - Choice-Makros wie `plural()`, `select()`, `selectOrdinal()`

Relevante Dateien:

- [crates/palamedes/src/extract.rs](/Users/sebastian/Workspace/business/palamedes/crates/palamedes/src/extract.rs)
- [packages/extractor/src/extractMessages.ts](/Users/sebastian/Workspace/business/palamedes/packages/extractor/src/extractMessages.ts)

### Transform

- Der native Transform deckt jetzt alle unterstützten Makroformen ab
- Der Wrapper nutzt den Rust-Core als einzigen Transformpfad
- Sourcemaps werden aus nativen Edit-Metadaten erzeugt

Aktuell nativ abgedeckt:

- `t`/`msg` Tagged Templates
- `t({...})`, `msg({...})`, `defineMessage({...})`
- `plural(...)`, `select(...)`, `selectOrdinal(...)`
- `<Trans>`, `<Plural>`, `<Select>`, `<SelectOrdinal>`
- Entfernen von Macro-Imports
- Einfügen des Runtime-Imports
- `getI18n()`-basiertes Runtime-Target

Relevante Dateien:

- [crates/palamedes/src/transform.rs](/Users/sebastian/Workspace/business/palamedes/crates/palamedes/src/transform.rs)
- [packages/transform/src/transform.ts](/Users/sebastian/Workspace/business/palamedes/packages/transform/src/transform.ts)
- [packages/core-node/src/index.ts](/Users/sebastian/Workspace/business/palamedes/packages/core-node/src/index.ts)

### Runtime-Modell

- Neues Runtime-Paket eingeführt: [packages/runtime](/Users/sebastian/Workspace/business/palamedes/packages/runtime)
- Neues Zielmodell ist `getI18n()` statt `useLingui()` / `getLingui()`
- Runtime-API:
  - `getI18n()`
  - `setClientI18n()`
  - `setServerI18nGetter()`
  - `resetI18nRuntime()`
- Beispiele auf dieses Modell umgestellt

### Tooling und Packaging

- Workspace von Yarn 4 + PnP auf `pnpm` migriert
- `pnpm-workspace.yaml` und `pnpm-lock.yaml` eingeführt
- Yarn-/PnP-Artefakte entfernt
- Repo-Dokumentation auf `pnpm` umgestellt
- Öffentliche Paketoberfläche auf Palamedes-Namen umgestellt:
  - `packages/extractor`
  - `packages/transform`
  - `packages/vite-plugin`
  - `packages/next-plugin`
- `@palamedes/next-plugin` liefert jetzt die realen Loader-Dateien aus:
  - [packages/next-plugin/palamedes-loader.cjs](/Users/sebastian/Workspace/business/palamedes/packages/next-plugin/palamedes-loader.cjs)
  - [packages/next-plugin/palamedes-po-loader.cjs](/Users/sebastian/Workspace/business/palamedes/packages/next-plugin/palamedes-po-loader.cjs)
- `@palamedes/core-node` baut jetzt zusätzlich CJS, damit der Next-Loader-Pfad funktioniert

Begleitende Design-Dokumente:

- [docs/plans/2026-03-10-pnpm-migration-design.md](/Users/sebastian/Workspace/business/palamedes/docs/plans/2026-03-10-pnpm-migration-design.md)
- [docs/plans/2026-03-10-next-loader-packaging-design.md](/Users/sebastian/Workspace/business/palamedes/docs/plans/2026-03-10-next-loader-packaging-design.md)
- [docs/plans/2026-03-10-palamedes-hard-rename-design.md](/Users/sebastian/Workspace/business/palamedes/docs/plans/2026-03-10-palamedes-hard-rename-design.md)

## Aktueller Verifikationsstand

Heute erneut geprüft:

- `pnpm build` ✅
- `pnpm test` ✅
- `pnpm check-types` ✅

## Offene TODOs

### Kurzfristig

1. Den nativen Transform weiter Richtung Parität bringen
2. Den Verifikationsstand für Beispiel-Builds und Cargo-Workspace wieder ausdrücklich auffrischen
3. Alte `useLingui()` / `getLingui()`-Spuren außerhalb des Transforms gezielt aus Doku und verbleibenden Implementierungen entfernen

### Mittelfristig

1. CLI-, Vite- und Next-Pfade noch konsequenter auf den nativen Core ausrichten
2. Alte Transform-/Extractor-Spuren aus Doku und Restcode weiter abbauen
3. Native Packaging-/Release-Strategie dokumentieren und automatisieren
4. Benchmarks für Extract/Transform vor und nach der Migration ergänzen

### Offene Architekturfragen

1. Wie strikt verbleibende Lingui-Kompatibilität außerhalb des Transforms noch weitergetragen wird
2. Wie native Binaries für macOS/Linux/Windows veröffentlicht und konsumiert werden sollen

## Empfohlene nächste Schritte

1. Beispiel-Builds und Cargo-Workspace gemeinsam wieder ausdrücklich verifizieren
2. Verbleibende Altspuren wie `useLingui()` / `getLingui()` außerhalb des Transforms abbauen
3. Danach native Packaging-/Release-Fluss weiter härten

## Letzte relevante Commits

- `9de22c4` refactor: rename package surface to palamedes
- `78c1cce` chore: updated deps
- `c1aaa28` fix(cli): make workspace bin resilient
- `9368352` docs: add project status summary
- `608a77c` feat: ship next loader files
- `92aa106` chore: migrate workspace to pnpm
- `137a40b` feat: adopt geti18n runtime defaults
- `04af778` docs: adopt universal geti18n runtime model
- `881cdc7` feat: add native transform slice
- `09619af` feat: make native extractor the default
- `ec7efb9` feat: add native extractor slice
- `9e7a43e` chore: use published pofile beta crate
- `cb9e126` feat: add initial rust core spike
- `ff8aafc` docs: split adrs into separate files
- `8f27604` docs: add rust core migration design
