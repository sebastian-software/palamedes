# ICU Semantics Proof: Source to Runtime

Palamedes preserves ICU MessageFormat semantics across every pipeline stage it
controls:

```text
source -> extraction -> macro transform -> PO catalog -> catalog compile -> runtime render
```

That scope is deliberate. A translation management system sits outside the
Palamedes boundary, so its import and export behavior depends on the chosen
product, file format, and project configuration.

## Re-run the claim

```bash
pnpm proof:icu
```

The command uses the checked fixture under
[`proof/icu-semantics`](https://github.com/sebastian-software/palamedes/tree/main/proof/icu-semantics).
It does not call a hosted service or use a mocked TMS.

The fixture contains a `plural` nested inside both branches of a `select`. The
proof asserts:

1. extraction returns the exact source ICU message and context;
2. the macro transform binds `role` and `count` to the generated runtime call
   and emits the same compiled message ID as the catalog compiler;
3. a PO catalog update retains the exact `msgid`, `msgctxt`, and German
   translation;
4. source and translation retain the same argument names, selector kinds,
   branch keys, nesting, and `#` substitutions;
5. catalog compilation emits the exact translated ICU message without missing
   entries or ICU errors;
6. the transformed fixture is imported and renders six checked combinations
   across both `select` branches and the `=0`, `one`, and `other` plural
   branches.

The script prints hashes, the normalized selector shape, and the number of
runtime scenarios after all assertions pass.

## The claim boundary

Safe public wording:

> Palamedes keeps ICU semantics intact from source code through PO catalogs to
> runtime. Within the stages Palamedes controls, nested selectors are not
> flattened into a proprietary plural model.

Avoid claiming that every TMS preserves arbitrary ICU messages. Palamedes can
provide a lossless boundary on both sides of a TMS exchange, but only the
selected TMS can determine what happens during its import, editing, and export
steps.

## Public market snapshot

The following examples are a documentation snapshot checked on
**2026-07-23**, not a permanent or exhaustive ranking:

| Product    | Publicly documented ICU behavior                                                                                                                                                                    |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FormatJS   | Uses ICU Message syntax as its native message model, including `plural`, `select`, and `selectordinal`.                                                                                             |
| i18next    | Uses its own interpolation format by default. ICU is available through an i18n-format plugin; i18next documents that format plugins replace its native plural, interpolation, and context behavior. |
| Crowdin    | Documents editor support for ICU arguments, nested plurals, target-language plural categories, previews, and syntax errors.                                                                         |
| Phrase TMS | Parses ICU for supported formats when enabled; parsing is an all-or-nothing file/template setting, and ICU messages cannot be split or joined.                                                      |
| Weblate    | Documents ICU syntax and placeholder validation as a quality check enabled by a flag and automatically enabled for ARB and FormatJS JSON.                                                           |

Direct sources, all checked 2026-07-23:

- [FormatJS ICU syntax](https://formatjs.github.io/docs/core-concepts/icu-syntax/)
- [i18next plugins and i18n formats](https://www.i18next.com/overview/plugins-and-utils)
- [Crowdin ICU Message Syntax](https://support.crowdin.com/icu-message-syntax/)
- [Phrase ICU Message Format](https://support.phrase.com/hc/en-us/articles/7765077293852-ICU-Message-Format-TMS)
- [Weblate checks and fixups](https://docs.weblate.org/en/latest/user/checks.html#icu-message-format)

The broader research notes remain under
[`docs/research/competitors`](https://github.com/sebastian-software/palamedes/tree/main/docs/research/competitors).
Re-check their dates and primary sources before promoting another comparison
claim to the public site.
