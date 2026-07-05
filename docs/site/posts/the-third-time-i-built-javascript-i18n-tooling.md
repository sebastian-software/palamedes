# The Third Time I Built JavaScript i18n Tooling

Status: draft

Palamedes is not my first pass at JavaScript i18n.

That matters because i18n mistakes age badly. A clever shortcut can feel good
for the first screen and still become a migration problem two years later.
Message identity, catalog ownership, runtime boundaries, and translation
workflow shape all become harder to change once a product depends on them.

The first lesson came from gettext-style JavaScript i18n: source strings close
to the code, context when the same sentence means different things, extraction
into catalogs translators can inspect. That model is old, but the important
parts are still sound.

The second lesson came from recent enterprise work. Sebastian Werner's public
profile lists a Regrello project from October 2024 to September 2025 focused
on frontend internationalization with Lingui: replacing thousands of hardcoded
strings with translation macros, building language dictionaries, and putting
message extraction and compilation into the workflow. Salesforce later
announced the Regrello acquisition and noted that it completed on October 1, 2025.

That kind of migration work makes the pain concrete.

You see where source strings help. You see where magic keys get hard to
review. You see where framework-specific runtime decisions spread too far. You
see how much trust a team needs before it lets i18n tooling touch thousands of
files.

Palamedes is the third pass with those lessons made explicit.

The model is intentionally small:

- source-string-first `.po` catalogs
- `message + context` identity
- `getI18n()` as the runtime access point
- a Rust core for the careful tooling paths
- `ferrocat` for catalog and ICU semantics
- thin framework adapters

The repo also records why those choices exist. The ADRs are not decoration.
They explain the boundaries:

- why the core is Rust-first
- why message identity is source-string-first
- why compiled lookup keys are internal
- why the runtime model is `getI18n()`
- why translation augmentation stays local and provider-neutral
- why some tempting work is deferred

That last part is important. A young tool should not pretend to be finished.
It should be clear about what is done, what is not done, and what the design is
trying to protect.

The current proof is visible:

- five framework families in the example matrix
- cookie, route, subdomain, and tld locale strategies
- versioned browser screenshots
- reproducible benchmark commands
- comparison docs that treat Lingui and next-intl as real alternatives

This is the story behind Palamedes:

Use the authoring model that has proven durable. Remove the parts that made
older stacks harder to maintain. Keep the runtime and catalog semantics steady
as frameworks change. Show the work in the repo.

Evidence:

- [Sebastian Werner profile at Sebastian Software](https://sebastian-software.de/werner)
- [Sebastian Consulting profile](https://sebastian-consulting.de/de/werner)
- [qooxdoo](https://qooxdoo.org/)
- [Salesforce announcement for Regrello](https://www.salesforce.com/news/stories/salesforce-signs-definitive-agreement-to-acquire-regrello/)
- [Palamedes ADRs](../../../adr/001-project-scope-and-positioning.md)
- [proof and benchmark page](../../proof-and-benchmarks.md)

The next step is not a grand claim. It is a small one:

Try the [5-minute quickstart](../../first-working-translation.md), then inspect
the [example matrix](../../../examples/README.md). If the model feels boring in
the right way, Palamedes is doing its job.
