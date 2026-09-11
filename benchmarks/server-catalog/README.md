# Server catalog request allocation

Run `pnpm benchmark:server-catalog` after a frozen workspace install. The checked
[local result](./2026-09-11.json) uses eight locales, 2,000 constant messages per
locale and 2,000 retained request instances. Each request calls the real
`createI18n()`, `load()` and message lookup with its own time-zone option.

The shared-content run retained 2,886,632 bytes of request state. The comparison
that prepares one complete message map per request retained 199,885,984 bytes
and allocated 4,000,000 message entries. The benchmark instruments both
`Object.keys` and `Object.entries` during request loads; it fails if request
creation enumerates catalog contents. Unit tests separately verify this with
fresh instances and catalogs of different sizes.

The 100/2,000/10,000-message sweep measures preparation separately from warm
request creation. Mixed-locale and concurrent cold calls exercise the store.
ESM retention imports full constant-catalog modules and measures heap after
garbage collection without keeping application references. Two child processes
each report their own store and memory. Every used locale can remain retained
in each worker's module cache; invalidating the store is not an ESM eviction
mechanism. Retried loader failures may still encounter a cached ESM rejection.

These are local fixture measurements, not a production throughput promise.
They exclude network latency, use constant messages rather than a distribution
of rich message functions, and V8 heap deltas vary between runs. The copied-map
baseline isolates catalog duplication; it is not a measurement of an old
Palamedes release.

Host integration was additionally exercised in the Next cookie example using
its real adapter-generated native PO imports: twelve parallel mixed-locale RSC
requests, twelve parallel Server Actions, hydration, locale changes and lazy
navigation passed under Turbopack and webpack. The reproducible host command
lives with the Next delivery slice (`test:rsc-scope` and
`test:rsc-scope:webpack`); that host proof is separate from these microbenchmarks.
