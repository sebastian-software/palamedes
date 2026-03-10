# Palamedes Status

**Last updated:** 2026-03-10
**Branch:** `t3code/plan-pofile-thin-ts-wrapper`
**HEAD:** `608a77c` (`feat: ship next loader files`)
**Worktree before this document:** clean

## Summary

Der Branch hat den ersten größeren Umbau von Palamedes auf ein Rust-Core-Modell bereits gestartet.

Im aktuellen Stand sind Rust-Workspace, Node-Bindings, `pofile`-Integration, ein nativer Extractor, ein erster nativer Transform-Slice, das neue `getI18n()`-Runtime-Modell, die `pnpm`-Migration und die reparierte Next-Loader-Auslieferung umgesetzt.

Die größten offenen Baustellen liegen jetzt nicht mehr bei der Grundarchitektur, sondern bei Parität und Aufräumen: vollständige Rust-Transform-Abdeckung, Sourcemaps, Entfernen alter Kompatibilitätspfade, native Distribution und ein noch roter `check-types`-Pfad.

## Was erledigt ist

### Architektur und Entscheidungen

- Rust-Core-Zielbild dokumentiert: [docs/plans/2026-03-09-palamedes-rust-core-design.md](/Users/sebastian/.t3/worktrees/palamedes/t3code-462fd5ad/docs/plans/2026-03-09-palamedes-rust-core-design.md)
- ADR-Struktur auf einzelne Dateien unter [`adr/`](/Users/sebastian/.t3/worktrees/palamedes/t3code-462fd5ad/adr) umgestellt
- Zentrale ADRs ergänzt:
  - [ADR-011 Rust Core with Thin Node/TypeScript Wrappers](/Users/sebastian/.t3/worktrees/palamedes/t3code-462fd5ad/adr/011-rust-core-with-thin-node-typescript-wrappers.md)
  - [ADR-012 Native Node Bindings via napi-rs](/Users/sebastian/.t3/worktrees/palamedes/t3code-462fd5ad/adr/012-native-node-bindings-via-napi-rs.md)
  - [ADR-013 Hybrid Native Extractor Rollout](/Users/sebastian/.t3/worktrees/palamedes/t3code-462fd5ad/adr/013-hybrid-native-extractor-rollout.md)
  - [ADR-014 Universal `getI18n()` Runtime Primitive](/Users/sebastian/.t3/worktrees/palamedes/t3code-462fd5ad/adr/014-universal-geti18n-runtime-primitive.md)

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

- [crates/palamedes/src/extract.rs](/Users/sebastian/.t3/worktrees/palamedes/t3code-462fd5ad/crates/palamedes/src/extract.rs)
- [packages/extractor-oxc/src/extractMessages.ts](/Users/sebastian/.t3/worktrees/palamedes/t3code-462fd5ad/packages/extractor-oxc/src/extractMessages.ts)

### Transform

- Ein erster nativer Transform-Slice ist implementiert
- Der Wrapper nutzt Rust dort, wo die aktuelle native Abdeckung reicht
- Für Sourcemaps und noch nicht portierte Muster gibt es weiterhin JS-Fallbacks

Aktuell nativ abgedeckt:

- `t`/`msg` Tagged Templates
- `t({...})`, `msg({...})`, `defineMessage({...})`
- Entfernen von Macro-Imports
- Einfügen des Runtime-Imports
- `getI18n()`-basiertes Runtime-Target

Aktuell noch im JS-Fallback:

- Sourcemaps
- `plural`, `select`, `selectOrdinal`
- `useLingui()` / `getLingui()`-Kompatibilitätspfade
- JSX-Makros im Transform (`<Trans>`, `<Plural>`, `<Select>`, `<SelectOrdinal>`)

Relevante Dateien:

- [crates/palamedes/src/transform.rs](/Users/sebastian/.t3/worktrees/palamedes/t3code-462fd5ad/crates/palamedes/src/transform.rs)
- [packages/oxc-transform/src/transform.ts](/Users/sebastian/.t3/worktrees/palamedes/t3code-462fd5ad/packages/oxc-transform/src/transform.ts)
- [packages/oxc-transform/src/transformJs.ts](/Users/sebastian/.t3/worktrees/palamedes/t3code-462fd5ad/packages/oxc-transform/src/transformJs.ts)

### Runtime-Modell

- Neues Runtime-Paket eingeführt: [packages/runtime](/Users/sebastian/.t3/worktrees/palamedes/t3code-462fd5ad/packages/runtime)
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
- `@palamedes/next` liefert jetzt die realen Loader-Dateien aus:
  - [packages/nextjs-oxc/lingui-oxc-loader.cjs](/Users/sebastian/.t3/worktrees/palamedes/t3code-462fd5ad/packages/nextjs-oxc/lingui-oxc-loader.cjs)
  - [packages/nextjs-oxc/lingui-po-loader.cjs](/Users/sebastian/.t3/worktrees/palamedes/t3code-462fd5ad/packages/nextjs-oxc/lingui-po-loader.cjs)
- `@palamedes/core-node` baut jetzt zusätzlich CJS, damit der Next-Loader-Pfad funktioniert

Begleitende Design-Dokumente:

- [docs/plans/2026-03-10-pnpm-migration-design.md](/Users/sebastian/.t3/worktrees/palamedes/t3code-462fd5ad/docs/plans/2026-03-10-pnpm-migration-design.md)
- [docs/plans/2026-03-10-next-loader-packaging-design.md](/Users/sebastian/.t3/worktrees/palamedes/t3code-462fd5ad/docs/plans/2026-03-10-next-loader-packaging-design.md)

## Aktueller Verifikationsstand

Heute erneut geprüft:

- `pnpm build` ✅
- `pnpm test` ✅
- `cargo test --workspace` ✅
- `pnpm --filter @palamedes/example-vite build` ✅
- `pnpm --filter @palamedes/example-nextjs build` ✅
- `pnpm check-types` ❌

Aktueller `check-types`-Fehler:

- [packages/extractor-oxc/src/extractMessages.test.ts](/Users/sebastian/.t3/worktrees/palamedes/t3code-462fd5ad/packages/extractor-oxc/src/extractMessages.test.ts): fehlende Vitest-Globals (`describe`, `it`, `expect`) im TypeScript-Check
- [packages/extractor-oxc/src/extractMessagesJs.ts:415](/Users/sebastian/.t3/worktrees/palamedes/t3code-462fd5ad/packages/extractor-oxc/src/extractMessagesJs.ts#L415): `string | undefined` wird an eine Funktion übergeben, die `string` erwartet

## Offene TODOs

### Kurzfristig

1. `pnpm check-types` wieder grün machen
2. Den nativen Transform weiter Richtung Parität bringen
3. Die verbleibenden `useLingui()` / `getLingui()`-Kompatibilitätspfade aus Transform, Tests und Doku zurückdrängen

### Mittelfristig

1. Sourcemap-Strategie für den Rust-Transform entscheiden und umsetzen
2. CLI-, Vite- und Next-Pfade noch konsequenter auf den nativen Core ausrichten
3. Alte TS-Core-Logik entfernen, sobald die Rust-Pfade vollständig genug sind
4. Native Packaging-/Release-Strategie dokumentieren und automatisieren
5. Benchmarks für Extract/Transform vor und nach der Migration ergänzen

### Offene Architekturfragen

1. Wann `useLingui()` und `getLingui()` nur noch Kompatibilität und nicht mehr empfohlene API sind
2. Wie strikt der Rust-Transform bestehende Lingui-Kompatibilität weiterträgt, bevor Palamedes-native APIs die Defaults werden
3. Wie native Binaries für macOS/Linux/Windows veröffentlicht und konsumiert werden sollen

## Empfohlene nächste Schritte

1. `check-types` reparieren, damit Root-Verifikation wieder vollständig grün ist
2. Nächsten Rust-Transform-Slice umsetzen: `plural` / `select` / `selectOrdinal`
3. Danach JSX-Transform-Fälle und Sourcemaps angehen
4. Anschließend TS-Fallbacks und Altpfade gezielt abbauen

## Letzte relevante Commits

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
