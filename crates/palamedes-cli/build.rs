#[path = "build_support/update_endpoint.rs"]
mod update_endpoint;

fn main() {
    update_endpoint::configure();
}
