use std::env;

pub const UPDATE_ENDPOINT_ENV: &str = "PALAMEDES_UPDATE_ENDPOINT";
pub const VALIDATED_UPDATE_ENDPOINT_ENV: &str = "PALAMEDES_VALIDATED_UPDATE_ENDPOINT";
pub const UPDATE_ENDPOINT_CFG: &str = "palamedes_update_endpoint";
pub const ALLOWED_UPDATE_HOST: &str = "version-service.sebastian-software.de";
pub const ALLOWED_UPDATE_PATH: &str = "check";

pub fn configure() {
    println!("cargo:rerun-if-env-changed={UPDATE_ENDPOINT_ENV}");
    println!("cargo:rustc-check-cfg=cfg({UPDATE_ENDPOINT_CFG})");

    let Some(endpoint) = env::var_os(UPDATE_ENDPOINT_ENV) else {
        return;
    };
    let endpoint = endpoint.into_string().unwrap_or_else(|_| {
        panic!("{UPDATE_ENDPOINT_ENV} must contain valid Unicode text");
    });
    validate(&endpoint).unwrap_or_else(|reason| {
        panic!("invalid {UPDATE_ENDPOINT_ENV}: {reason}");
    });

    println!("cargo:rustc-cfg={UPDATE_ENDPOINT_CFG}");
    println!("cargo:rustc-env={VALIDATED_UPDATE_ENDPOINT_ENV}={endpoint}");
}

pub fn validate(endpoint: &str) -> Result<(), &'static str> {
    if endpoint.chars().any(char::is_whitespace) {
        return Err("whitespace is not allowed");
    }

    let Some(authority_and_path) = endpoint.strip_prefix("https://") else {
        return Err("the scheme must be https");
    };
    if authority_and_path.contains(['?', '#']) {
        return Err("query strings and fragments are not allowed");
    }

    let Some((authority, path)) = authority_and_path.split_once('/') else {
        return Err("a non-empty path is required");
    };
    if authority != ALLOWED_UPDATE_HOST {
        return Err(
            "the host must be version-service.sebastian-software.de without userinfo or a port",
        );
    }
    if path.is_empty() {
        return Err("a non-empty path is required");
    }
    if path != ALLOWED_UPDATE_PATH {
        return Err("the path must be /check");
    }

    Ok(())
}
