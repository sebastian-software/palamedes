#![no_main]

use std::collections::BTreeMap;

use libfuzzer_sys::fuzz_target;
use palamedes::{
    TargetTextCheckOptions, TranslationCandidateId, TranslationPatch, TranslationPatchRequest,
    TranslationPluralKind, TranslationTargetText, TranslationTargetTextRequest, TranslationValue,
};

const MAX_INPUT_BYTES: usize = 16 * 1024;
const MAX_BRANCHES: usize = 8;

fn all_checks() -> TargetTextCheckOptions {
    TargetTextCheckOptions {
        boundary_whitespace: true,
        metadata_leakage: true,
    }
}

fuzz_target!(|data: &[u8]| {
    if data.len() > MAX_INPUT_BYTES {
        return;
    }

    // 1. Untrusted JSON request / patch deserialization + read-only target validation.
    if let Ok(mut request) = serde_json::from_slice::<TranslationTargetTextRequest>(data) {
        let _ = palamedes::check_translation_targets(&request);
        request.checks = all_checks();
        let _ = palamedes::check_translation_targets(&request);
    }

    if let Ok(patch_request) = serde_json::from_slice::<TranslationPatchRequest>(data) {
        let targets = patch_request
            .patches
            .into_iter()
            .map(|patch| TranslationTargetText {
                id: patch.id,
                translation: patch.translation,
            })
            .collect();
        let _ = palamedes::check_translation_targets(&TranslationTargetTextRequest {
            targets,
            checks: all_checks(),
        });
    }

    if let Ok(patch) = serde_json::from_slice::<TranslationPatch>(data) {
        let _ = palamedes::check_translation_targets(&TranslationTargetTextRequest {
            targets: vec![TranslationTargetText {
                id: patch.id,
                translation: patch.translation,
            }],
            checks: all_checks(),
        });
    }

    // 2. Direct structured construction from raw UTF-8 to exercise render_translation_value,
    //    validate_plural_variable, parse_plural_branch, and check_target_text on arbitrary text.
    let Some((selector, rest)) = data.split_first() else {
        return;
    };
    let Ok(text) = std::str::from_utf8(rest) else {
        return;
    };

    let mut lines = text.split('\n');
    let source = lines.next().unwrap_or("");
    let variable = lines.next().unwrap_or("count");
    let first_branch = lines.next().unwrap_or(source);

    let mut values = BTreeMap::new();
    values.insert("other".to_owned(), first_branch.to_owned());
    for (index, line) in lines.take(MAX_BRANCHES).enumerate() {
        let (branch_selector, branch_value) = match line.split_once('=') {
            Some((k, v)) if !k.is_empty() => (k.to_owned(), v.to_owned()),
            _ => (
                match index {
                    0 => "one".to_owned(),
                    1 => "=0".to_owned(),
                    2 => "few".to_owned(),
                    _ => format!("={index}"),
                },
                line.to_owned(),
            ),
        };
        values.insert(branch_selector, branch_value);
    }

    let plural_kind = if selector & 1 == 0 {
        TranslationPluralKind::Cardinal
    } else {
        TranslationPluralKind::Ordinal
    };
    let offset = u32::from(selector >> 4);

    let candidate_id = TranslationCandidateId {
        catalog: "locales/{locale}".to_owned(),
        locale: "de".to_owned(),
        message: source.to_owned(),
        context: None,
    };

    let _ = palamedes::check_translation_targets(&TranslationTargetTextRequest {
        targets: vec![
            TranslationTargetText {
                id: candidate_id.clone(),
                translation: TranslationValue::Singular {
                    value: first_branch.to_owned(),
                },
            },
            TranslationTargetText {
                id: candidate_id,
                translation: TranslationValue::Plural {
                    variable: variable.to_owned(),
                    plural_kind,
                    offset,
                    values,
                },
            },
        ],
        checks: all_checks(),
    });
});
