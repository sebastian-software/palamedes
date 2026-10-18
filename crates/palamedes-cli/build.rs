#[path = "build_support/cli_catalogs.rs"]
mod cli_catalogs;
#[path = "build_support/update_endpoint.rs"]
mod update_endpoint;

fn main() {
    update_endpoint::configure();
    cli_catalogs::generate().expect("compile CLI translation catalogs");
}
