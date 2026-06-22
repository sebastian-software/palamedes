use ferrocat::{parse_icu, IcuMessage};

pub(crate) fn parse_runtime_icu(message: &str) -> Option<IcuMessage> {
    parse_icu(&runtime_icu_validation_view(message)).ok()
}

fn runtime_icu_validation_view(message: &str) -> String {
    message.replace('\'', "''")
}
