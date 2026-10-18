#[path = "build_support/update_endpoint.rs"]
mod update_endpoint;

fn main() {
    update_endpoint::configure();
    let catalogs = palamedes_build::CatalogBuilder::new("locales", "en")
        .locales(&["en", "de", "es"])
        .build()
        .expect("compile external CLI translation catalogs");
    // Cargo has no asset-install phase for native executables. Place the
    // generated data beside the executable in its target/profile directory;
    // npm packaging copies this directory together with the executable.
    let output = std::path::PathBuf::from(std::env::var_os("OUT_DIR").unwrap());
    let profile_directory = output.ancestors().nth(3).expect("Cargo profile directory");
    catalogs
        .install_to(&profile_directory.join("pmds-locales"))
        .expect("install development CLI catalogs");
}
