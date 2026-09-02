#[cfg(palamedes_update_endpoint)]
fn main() {
    assert_eq!(
        env!("PALAMEDES_VALIDATED_UPDATE_ENDPOINT"),
        "https://version-service.sebastian-software.de/check"
    );
}

#[cfg(not(palamedes_update_endpoint))]
fn main() {}
