fn main() {
    palamedes_build::CatalogBuilder::new("locales", "en")
        .locales(&["en", "de", "es"])
        .build()
        .expect("compile external example catalogs");
}
