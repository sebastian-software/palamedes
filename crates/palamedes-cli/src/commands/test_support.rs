//! Project fixtures shared by the command tests.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

/// Writes a two-locale project config with one catalog over `app/`.
pub(super) fn write_config(dir: &Path, source_reference_root: Option<&str>) {
    fs::create_dir_all(dir).expect("create config dir");
    let reference_root = source_reference_root
        .map(|value| format!("source-reference-root: {value}\n"))
        .unwrap_or_default();
    fs::write(
        dir.join("palamedes.yaml"),
        format!(
            r#"locales: [en, de]
source-locale: en
{reference_root}catalogs:
  - path: locales/{{locale}}/messages
    include: [app]
"#
        ),
    )
    .expect("write config");
}

/// A fresh temp directory, named after the test that asked for it.
pub(super) fn temp_dir(name: &str) -> PathBuf {
    let id = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_nanos();
    let dir = std::env::temp_dir().join(format!("palamedes-cli-{name}-{id}"));
    fs::create_dir_all(&dir).expect("create temp dir");
    dir
}
