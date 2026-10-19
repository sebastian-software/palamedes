//! Manual compiler benchmark: actual generated module versus the previous
//! per-call-site signature chain, with the same messages, calls, and toolchain.
use std::fs;
use std::path::Path;
use std::process::Command;
use std::time::Instant;

#[test]
#[ignore = "manual compiler benchmark; run with --ignored --nocapture"]
fn generated_lookup_compilation() {
    let count: usize = std::env::var("PALAMEDES_RUST_BENCH_MESSAGES")
        .ok()
        .map(|value| value.parse().unwrap())
        .unwrap_or(500);
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path();
    fs::create_dir(root.join("src")).unwrap();
    fs::create_dir(root.join("locales")).unwrap();
    let runtime = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../palamedes-i18n")
        .canonicalize()
        .unwrap();
    fs::write(root.join("Cargo.toml"), format!("[package]\nname=\"macro-compilation-benchmark\"\nversion=\"0.0.0\"\nedition=\"2024\"\n[workspace]\n[dependencies]\npalamedes-i18n={{path={:?}}}\n", runtime.to_str().unwrap())).unwrap();
    let sources: Vec<_> = (0..count)
        .map(|index| format!("Message {index:05}"))
        .collect();
    fs::write(
        root.join("locales/en.po"),
        sources
            .iter()
            .map(|source| format!("msgid {source:?}\nmsgstr {source:?}\n\n"))
            .collect::<String>(),
    )
    .unwrap();
    let compiled = palamedes_build::CatalogBuilder::new(root.join("locales"), "en")
        .locales(&["en"])
        .compile_to(&root.join("generated"))
        .unwrap();
    let generated = fs::read_to_string(compiled.rust_module).unwrap();
    let calls = sources
        .iter()
        .map(|source| format!("let _ = translate!(catalog, {source:?});\n"))
        .collect::<String>();
    let rustc = Path::new(env!("CARGO")).with_file_name("rustc");
    println!(
        "toolchain: {}",
        String::from_utf8(
            Command::new(&rustc)
                .arg("--version")
                .output()
                .unwrap()
                .stdout
        )
        .unwrap()
        .trim()
    );
    println!(
        "host: {}/{}; cargo check, incremental disabled; {count} messages and calls; one run per variant",
        std::env::consts::OS,
        std::env::consts::ARCH
    );
    let check = || {
        let output = Command::new(env!("CARGO"))
            .args(["check", "--offline", "--quiet"])
            .env("RUSTC", &rustc)
            .env("CARGO_INCREMENTAL", "0")
            .env("CARGO_TARGET_DIR", root.join("target"))
            .env("CARGO_BUILD_BUILD_DIR", root.join("build"))
            .current_dir(root)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
    };
    // Compile dependencies once, outside the timed intervals.
    fs::write(root.join("src/lib.rs"), &generated).unwrap();
    check();
    let mut chain = String::new();
    for (index, source) in sources.iter().enumerate() {
        if index > 0 {
            chain.push_str("else ");
        }
        let id = ferrocat::compiled_key_with_policy(
            source,
            None,
            ferrocat::IcuSyntaxPolicy::RuntimeLiteralApostrophes,
        );
        chain.push_str(&format!("if ::palamedes_i18n::source_eq($source, {source:?}) {{ ({id:?}, &[] as &[&str], true) }}\n"));
    }
    chain.push_str("else { panic!(\"source message is absent from compiled catalogs\") }");
    let needle = "(@signature $source:literal) => { const { $crate::__palamedes_translate_signature($source) } };";
    assert!(generated.contains(needle));
    let baseline = generated.replace(
        needle,
        &format!("(@signature $source:literal) => {{ const {{ {chain} }} }};"),
    );
    for (name, module) in [
        ("previous per-call chain", baseline),
        ("generated binary search", generated),
    ] {
        fs::write(root.join("src/lib.rs"), format!("#![recursion_limit=\"16384\"]\n{module}\npub fn check(catalog: &palamedes_i18n::Catalog) {{ {calls} }}\n")).unwrap();
        let started = Instant::now();
        check();
        println!("{name}: {:.3}s", started.elapsed().as_secs_f64());
    }
}
