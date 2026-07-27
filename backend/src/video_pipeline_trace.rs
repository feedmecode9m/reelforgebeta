//! Temporary BG-VIDEO-READY-01 pipeline tracing.
//! Emits structured `[VIDEO_PIPELINE]` lines for Railway log inspection.

use serde_json::json;

#[allow(clippy::too_many_arguments)]
pub fn trace(
    stage: &str,
    file_name: impl AsRef<str>,
    file_size: Option<i64>,
    storage_key: impl AsRef<str>,
    status_before: impl AsRef<str>,
    status_after: impl AsRef<str>,
    error: impl AsRef<str>,
) {
    let err = error.as_ref();
    let payload = json!({
        "stage": stage,
        "fileName": file_name.as_ref(),
        "fileSize": file_size,
        "storageKey": storage_key.as_ref(),
        "statusBefore": status_before.as_ref(),
        "statusAfter": status_after.as_ref(),
        "error": if err.is_empty() { serde_json::Value::Null } else { json!(err) },
    });
    eprintln!("[VIDEO_PIPELINE] {}", payload);
}
