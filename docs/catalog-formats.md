# Catalog Formats

Palamedes catalogs are source-string-first. The semantic message identity is
`message + context`; compiled lookup keys remain an internal runtime detail.

Palamedes currently exposes two catalog storage formats:

| Format | Extension | Best fit                                                                 |
| ------ | --------- | ------------------------------------------------------------------------ |
| PO     | `.po`     | Default, translator-friendly gettext-style files and current app imports |
| FCL    | `.fcl`    | Canonical Ferrocat Catalog Lines for generated, merge-friendly storage   |

## PO

PO is the default because it is familiar, human-editable, and supported by the
current Vite and Next loader paths. A minimal config does not need a `format`
field:

```yaml
locales: [en, de]
source-locale: en
catalogs:
  - path: src/locales/{locale}
    include: [src]
```

That writes `src/locales/en.po` and `src/locales/de.po`.

PO output can be configured per catalog with the nested `po` object: set
`line-breaks: "off"` to disable automatic width folding. Catalog order is not
configurable — Ferrocat sorts both PO and FCL catalogs by source message and
then gettext context using the CLDR root collation. See
[Configuration](./configuration.md#catalogs) for the schema and the JavaScript
spellings.

One divergence is worth knowing about when catalogs move between Palamedes and
gettext tooling: Ferrocat keeps a short value with embedded newlines in the
compact `msgid "First line\n"` plus continuation-line form under both `auto`
and `off`. GNU gettext and `pofile` commonly use a leading empty `msgid ""` or
`msgstr ""` line for the same value. Set `line-breaks: "off"` to avoid
additional width-driven folding. Both spellings parse to the same message, but
the difference can show up as mechanical diffs.

## FCL

FCL means Ferrocat Catalog Lines. It is a line-oriented Ferrocat catalog format
that Palamedes treats as canonical generated storage. Use it when the catalog
files are mostly maintained by `pmds extract`, merge drivers, or automation
rather than hand-edited as gettext PO files.

Opt in per catalog:

```yaml
locales: [en, de]
source-locale: en
catalogs:
  - path: src/locales/{locale}
    format: fcl
    include: [src]
```

That writes `src/locales/en.fcl` and `src/locales/de.fcl`.

FCL is not NDJSON. The older `ndjson` config value is intentionally rejected;
use `format: fcl` instead.

For existing projects moving from old NDJSON catalog settings, see
[Migrating to Palamedes 1.0](./migrations/1.0.0.md).

## Runtime Loading

Catalog storage and framework module loading are related but separate:

- `pmds extract`, `pmds audit`, `pmds catalog merge`, and native compile APIs
  understand both PO and FCL through the Palamedes config.
- The current first-party Vite and Next import loaders are still `.po` import
  loaders. Keep app-facing imports on PO unless the host adapter explicitly
  documents FCL imports.
- `pmds catalog convert` can write `.fcl` files beside existing `.po` files so
  teams can trial FCL storage before changing config.

## Converting Existing Catalogs

Convert one catalog:

```bash
pmds catalog convert src/locales/de.po --to fcl --output src/locales/de.fcl
```

Convert every configured PO catalog:

```bash
pmds catalog convert --config palamedes.yaml --to fcl
```

After conversion, update the matching catalog config to `format: fcl`. Config
mode derives each output through the target-format resolver, so a path that
already ends in `.po` produces `.po.fcl`; keep the configured path unchanged
and switch only its format.

The full 1.0 migration checklist, including merge-driver cleanup and metadata
shape changes, lives in [Migrating to Palamedes 1.0](./migrations/1.0.0.md).
