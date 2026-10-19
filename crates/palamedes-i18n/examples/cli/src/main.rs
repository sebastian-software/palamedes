use std::path::PathBuf;

include!(concat!(env!("OUT_DIR"), "/messages.rs"));

fn run() -> Result<(), Box<dyn std::error::Error>> {
    let mut arguments = std::env::args_os().skip(1);
    // The host owns catalog discovery; neither the runtime nor generated code
    // contains a checkout-relative path or a bundled language fallback.
    let directory = PathBuf::from(
        arguments
            .next()
            .ok_or("expected catalog directory argument")?,
    );
    let locale = arguments
        .next()
        .ok_or("expected locale argument")?
        .into_string()
        .map_err(|_| "locale must be UTF-8")?;
    let name = arguments
        .next()
        .unwrap_or_else(|| "Ada".into())
        .to_string_lossy()
        .into_owned();
    let count: u64 = arguments
        .next()
        .unwrap_or_else(|| "2".into())
        .to_string_lossy()
        .parse()?;
    let catalog = palamedes_i18n::Catalog::load(
        directory.join(format!("{locale}.pmd.json")),
        &locale,
        CATALOG_SCHEMA,
    )?;
    println!("{}", translate!(&catalog, r"Hello {name}!", name = name)?);
    println!(
        "{}",
        translate!(
            &catalog,
            "{mode, select, preview {Preview for {name}} other {Ready for {name}}}",
            mode = "preview",
            name = name
        )?
    );
    println!(
        "{}",
        translate!(
            &catalog,
            "{count, plural, one {# file} other {# files}}",
            count = count
        )?
    );
    Ok(())
}

fn main() -> std::process::ExitCode {
    match run() {
        Ok(()) => std::process::ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("{error}");
            std::process::ExitCode::FAILURE
        }
    }
}
