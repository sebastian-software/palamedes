# React Native And Expo Support Assessment

Research snapshot: October 17, 2026, against Palamedes `5d956a42`.
Implementation and device verification remain open in [#1263](https://github.com/sebastian-software/palamedes/issues/1263).

## Recommendation

Start with an Expo application on iOS and Android, using the existing compiled
JavaScript runtime and React message renderer. Keep native compilation on the
development/build host. A mobile Rust runtime or N-API binding is not required
by the current message representation.

This is a proposed implementation direction, not a supported integration or an
accepted architecture change. React Native support should remain outside the v2
support claim until a Metro build and native release-mode proof pass. The
existing browser integration work can proceed independently.

## Compatible Starting Point

The published `expo@58.0.14` artifact's `bundledNativeModules.json` specifies:

| Dependency         | Expo's declared combination |
| ------------------ | --------------------------- |
| React              | `19.3.0`                    |
| React Native       | `0.88.0`                    |
| Expo localization  | `~58.0.4`                   |
| Expo Metro runtime | `~58.0.14`                  |

These values come from one Expo SDK artifact, rather than independent `latest`
tags. The [Expo package metadata](https://registry.npmjs.org/expo/58.0.14)
identifies that artifact. [React Native 0.88.0](https://registry.npmjs.org/react-native/0.88.0)
declares React `^19.3.0` and Node `^22.13.0 || ^24.3.0 || >=26.0.0`.
The first fixture should pin the complete resolved graph and record the bundled
Metro and Hermes versions. This assessment has not installed or built that app.

## What Can Be Reused

`packages/core/src/compiled.ts` and the message runtime execute generated
JavaScript functions. They do not need an ICU parser or native compiler on the
device. Macro transformation and catalog generation should continue through
`@palamedes/core-node` on the Node build host, as required by
[ADR-005](../../adr/005-generated-production-runtime-is-parser-free.md) and
[ADR-019](../../adr/019-native-catalog-rendering-produces-bundler-modules.md).

`packages/react/src/transShared.tsx` uses React elements, fragments, and element
cloning without importing React DOM or manufacturing HTML elements. Reusing it
for native `Text` is plausible. Native text layout, event props, and
accessibility still need a real renderer proof; a React DOM test is insufficient.

The absence of a browser document does not by itself prove a runtime-classification
bug. React Native 0.88.0's shipped `Libraries/Core/setUpGlobals.js` installs
`window` as an alias of `globalThis` before application code. Palamedes'
`isServerEnvironment()` currently recognizes that environment as client-side
when initialization occurs in that order. Verify the order in Metro and Hermes,
including Fast Refresh, instead of adding an unneeded platform heuristic.

## Missing Boundaries

### Metro Transformation And Catalog Dependencies

There is no Metro adapter in the repository. Compose the native macro transform
with the host's transformer before ordinary TSX lowering, preserving source
maps, dependency reporting, cache keys, and Fast Refresh. Expo explicitly
requires custom transformers to delegate to
[`@expo/metro-config/babel-transformer`](https://docs.expo.dev/versions/latest/config/metro/#extending-the-babel-transformer)
so its preset and caller metadata survive. Palamedes does not need a second
Babel implementation of message semantics.

The prototype must resolve generated compiled catalogs through Metro's module
graph and invalidate them when configuration or catalogs change. Begin with
bundled executable catalogs so the first launch can work offline. Compare
active-locale selection with the size cost of bundling additional locales;
remote locale delivery can follow only with an explicit offline and failure
contract. Do not present application-owned locale loader maps as the standard
integration under [ADR-008](../../adr/008-framework-adapter-architecture.md).

### Package Resolution And Native Rendering

The React package currently requires `react-dom` as a peer even though its
compiled renderer does not import it. Check packed consumers with Metro's
[`exports` resolution](https://metrobundler.dev/docs/package-exports/) before
choosing an optional peer, a native condition, or a separate entrypoint. Avoid
adding another published package until the probe identifies a boundary that
needs one.

Native string children must occur beneath `Text`, as described in
[React Native's text contract](https://reactnative.dev/docs/text). Exercise
ordinary macros for string props, nested styled/tappable `Text` for rich
messages, and translated accessibility labels. Inspect a release bundle for
Node built-ins, DOM code, compiler bindings, live macros, and ICU parser code.

### Locale Lifecycle

Keep the shared `getI18n()` access primitive from
[ADR-006](../../adr/006-universal-geti18n-runtime-model.md). A browser-document
navigation is not a mobile language-change mechanism.

The first prototype should resolve a locale before mounting and compare an
explicit whole-root remount with an application restart. Include module-level
translated values, data caches, persistence, and non-React consumers in that
boundary. Do not add a subscription API merely to rerender translated nodes;
partial invalidation can leave the rest of the app in another language.
[ADR-007](../../adr/007-locale-is-fixed-for-a-browser-document.md) already
describes an application-owned keyed remount, but does not establish a native
support contract. Adopt any required native lifecycle decision explicitly.

Use [Expo localization](https://docs.expo.dev/versions/latest/sdk/localization/)
for device preferences in the proposed fixture. Android preferences may change
while the app is backgrounded, so verify foreground re-entry as well as cold
launch. Record the precedence of an explicit saved app choice, OS preferences,
and configured fallback. RTL layout and a native restart requirement, if any,
must be documented separately from translated text.

### Hermes And Failure Behavior

Verify `Intl.NumberFormat`, `DateTimeFormat`, `PluralRules`, ordinal branches,
time zones, and configured locale data on both native platforms. Desktop Node
output does not prove Hermes parity. Identify a specific missing capability
before introducing a polyfill or locale-data payload.

Catalogs must be ready before translated modules or views execute. A missing or
invalid compiled entry must reach ordinary application error UI without raw
source substitutions or internal IDs. Test an offline first launch, a rejected
catalog, recovery, and a failed language change while the previous UI remains
usable. Development and release builds must share the compiled runtime model.

## Implementation Slices And Evidence

Effort bands describe relative engineering scope, not dates or commitments.

| Slice                           | Scope and estimate                                                           | Completion evidence                                                                                                           |
| ------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Expo/Metro proof                | Medium; highest uncertainty is module dependency and cache integration       | Pinned fixture bundles for iOS/Android, transforms TSX, reports authored source positions, and refreshes catalog/config edits |
| Runtime/package and native text | Small to medium; depends on the first packed consumer                        | Native startup plus plain/rich/accessibility output, with no DOM/compiler/parser in release bundles                           |
| Catalog and locale lifecycle    | Medium to large; depends on the proven module graph and a lifecycle decision | Offline startup, explicit language switch, saved preference, foreground OS change, errors, and recovery on both platforms     |
| Support and CI gate             | Medium; depends on the complete native flow                                  | Repeatable simulator/emulator or device release checks, exact support matrix, documentation, and explicit limitations         |

The existing `examples/` matrix is a web locale-routing matrix. Do not add
mobile cases to its cookie/route/subdomain/TLD counts. A private mobile fixture
and native verification lane need their own clearly stated scope.

## Verification Status

Source and published package inspection establish a feasible starting point.
No Expo/Metro build, native render, Hermes formatting result, or offline/language
change behavior has been verified here. Do not infer support from the shared
React package or from the compatible dependency metadata.

The next executable step is the pinned Expo/Metro fixture with packed Palamedes
packages. Keep #1263 open until its native proof and implementation breakdown
are complete; settle the v2-versus-follow-up scope from that evidence.
