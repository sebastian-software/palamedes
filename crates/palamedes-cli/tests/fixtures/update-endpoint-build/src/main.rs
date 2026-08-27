#[cfg(palamedes_update_endpoint)]
fn main() {
    assert_eq!(
        env!("PALAMEDES_VALIDATED_UPDATE_ENDPOINT"),
        "https://version.sebastian-software.dev/check"
    );
}

#[cfg(not(palamedes_update_endpoint))]
fn main() {}
