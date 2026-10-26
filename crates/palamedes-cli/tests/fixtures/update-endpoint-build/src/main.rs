#[cfg(palamedes_update_endpoint)]
fn main() {
    assert_eq!(
        env!("PALAMEDES_VALIDATED_UPDATE_ENDPOINT"),
        "https://sebastian-app-tracking.b-cdn.net/v1/versions/palamedes/github/stable"
    );
}

#[cfg(not(palamedes_update_endpoint))]
fn main() {}
