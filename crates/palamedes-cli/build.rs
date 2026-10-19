#[path = "build_support/update_endpoint.rs"]
mod update_endpoint;

fn main() {
    update_endpoint::configure();
    palamedes_build::CatalogBuilder::new("locales", "en")
        .locales(&["en", "de", "es"])
        .module_path("crate::i18n")
        .fail_on_missing(true)
        .build()
        .expect("compile external CLI translation catalogs");
    // Asset installation belongs to the packaging host. Cargo reports this
    // build's OUT_DIR through --message-format=json even with build.build-dir.
}
