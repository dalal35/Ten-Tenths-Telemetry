use super::service::{validate_interval, validate_source};
use serde_json::json;

#[test]
fn source_must_match_saved_identity() {
    let saved = json!({"type":"local","path":"/saved.mp4","size":10,"modifiedMs":5});
    assert!(validate_source(&saved, &saved).is_ok());
    assert!(validate_source(
        &saved,
        &json!({"type":"local","path":"/other.mp4","size":10,"modifiedMs":5})
    )
    .is_err());
}

#[test]
fn interval_must_fit_full_media_and_bounded_scan() {
    assert!(validate_interval(0.0, 599.0, 600.0).is_ok());
    assert!(validate_interval(0.0, 2636.6, 2636.6).is_ok());
    assert!(validate_interval(0.0, 14400.1, 14401.0).is_err());
    assert!(validate_interval(0.0, 10.0, 9.0).is_err());
    assert!(validate_interval(f64::NAN, 10.0, 20.0).is_err());
}

#[test]
fn saved_source_alone_does_not_authorize_a_path() {
    assert!(super::service::require_authorized_path(false).is_err());
    assert!(super::service::require_authorized_path(true).is_ok());
}

#[test]
fn local_source_rejects_changed_and_missing_file() {
    let path = std::env::temp_dir().join(format!("sync-local-{}.mp4", std::process::id()));
    std::fs::write(&path, b"video").unwrap();
    let info = crate::video::inspect_local_video(&path).unwrap();
    let identity =
        json!({"type":"local", "path":info.path, "size":info.size, "modifiedMs":info.modified_ms});
    assert!(super::service::resolve_local(&identity, |_| true).is_ok());
    std::fs::write(&path, b"changed video").unwrap();
    assert!(super::service::resolve_local(&identity, |_| true).is_err());
    std::fs::remove_file(&path).unwrap();
    assert!(super::service::resolve_local(&identity, |_| true).is_err());
}
