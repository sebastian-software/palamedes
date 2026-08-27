use std::fs;
use std::process::Command;

#[test]
fn release_endpoint_is_disabled_by_default_without_cache_or_output_side_effects() {
    let home = tempfile::tempdir().expect("temporary home");
    let output = Command::new(env!("CARGO_BIN_EXE_pmds"))
        .arg("version")
        .env("HOME", home.path())
        .env("XDG_CACHE_HOME", home.path().join("cache"))
        .env_remove("DO_NOT_TRACK")
        .env_remove("PALAMEDES_UPDATE_CHECK")
        .output()
        .expect("run pmds version");

    assert!(output.status.success(), "{output:?}");
    assert_eq!(
        String::from_utf8_lossy(&output.stdout),
        format!(
            "pmds (Palamedes) v{}\nFast i18n tooling for modern apps\n",
            env!("CARGO_PKG_VERSION")
        )
    );
    assert!(output.stderr.is_empty(), "{output:?}");
    assert_eq!(
        fs::read_dir(home.path())
            .expect("read temporary home")
            .count(),
        0,
        "a build without the release endpoint must not create a cache"
    );
}
