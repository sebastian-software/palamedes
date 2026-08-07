mod catalog;
mod catalog_config;
mod extract;
mod mdx;
mod po;
mod shared;
mod source;
mod transform;

pub use self::catalog::*;
pub use self::extract::*;
pub use self::mdx::*;
pub use self::po::*;
pub use self::source::*;
pub use self::transform::*;

#[cfg(test)]
mod tests {
    const SYNC_NAPI_EXPORT_MODULES: [(&str, &str); 6] = [
        ("catalog.rs", include_str!("catalog.rs")),
        ("extract.rs", include_str!("extract.rs")),
        ("mdx.rs", include_str!("mdx.rs")),
        ("po.rs", include_str!("po.rs")),
        ("source.rs", include_str!("source.rs")),
        ("transform.rs", include_str!("transform.rs")),
    ];

    #[test]
    fn every_sync_napi_export_enables_panic_catching() {
        for (module, source) in SYNC_NAPI_EXPORT_MODULES {
            let unguarded_exports = source
                .lines()
                .enumerate()
                .filter_map(|(index, line)| (line.trim() == "#[napi]").then_some(index + 1))
                .collect::<Vec<_>>();

            assert!(
                unguarded_exports.is_empty(),
                "{module} has synchronous #[napi] exports without catch_unwind at lines {unguarded_exports:?}"
            );
        }
    }
}
