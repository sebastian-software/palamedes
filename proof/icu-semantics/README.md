# ICU semantics proof fixture

This fixture backs the public claim that Palamedes preserves ICU MessageFormat
semantics across every pipeline stage it controls:

```text
source -> extraction -> PO catalog update -> catalog compile -> runtime render
```

The message deliberately nests a `plural` inside both branches of a `select`.
The German catalog changes the prose while retaining the argument names,
selector types, branch keys, nesting, and `#` substitutions.

Run the checked proof from the repository root:

```bash
pnpm proof:icu
```

The command builds the public packages, performs the pipeline in a temporary
directory, compares the ICU syntax tree before and after translation, and
asserts all runtime outputs from `expected.json`.

This fixture does not simulate a translation management system. TMS
import/export behavior is outside the Palamedes boundary and must be described
per product, format, configuration, and observation date.
