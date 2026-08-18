use std::collections::HashMap;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use actix_web::http::header;
use actix_web::{web, HttpRequest, HttpResponse, Responder};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use sqlx::{Pool, Postgres};
use tokio::io::AsyncWriteExt;
use uuid::Uuid;

use crate::events::EventBus;
use crate::ingestion::{self, IngestionService};
use crate::media_validator;
use crate::video_stream::{ThumbsDir, VideosDir};

#[derive(Clone, Copy, PartialEq, Eq)]
enum UploadStatus {
    Pending,
    Uploaded,
    Finalized,
}

struct PendingUpload {
    reel_id: Uuid,
    token: String,
    stored_name: String,
    original_filename: String,
    content_type: String,
    expected_size: i64,
    title: Option<String>,
    description: Option<String>,
    category: Option<String>,
    episode_id: Option<String>,
    expires_at: i64,
    status: UploadStatus,
}

pub struct SignedUploadStore {
    sessions: tokio::sync::RwLock<HashMap<Uuid, PendingUpload>>,
    ttl_seconds: i64,
    max_bytes: i64,
}

impl SignedUploadStore {
    pub fn from_env() -> Self {
        let ttl_seconds = std::env::var("SIGNED_UPLOAD_TTL_SECONDS")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(3600)
            .max(300);
        let max_bytes = std::env::var("SIGNED_UPLOAD_MAX_BYTES")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(2_147_483_648); // 2 GiB
        Self {
            sessions: tokio::sync::RwLock::new(HashMap::new()),
            ttl_seconds,
            max_bytes,
        }
    }

    fn now_unix() -> i64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0)
    }

    fn new_token() -> String {
        format!("{}{}", Uuid::new_v4(), Uuid::new_v4()).replace('-', "")
    }

    async fn purge_expired(&self) {
        let now = Self::now_unix();
        let mut guard = self.sessions.write().await;
        guard.retain(|_, s| s.expires_at > now && s.status != UploadStatus::Finalized);
    }
}

fn upload_incomplete_response(expected: i64, actual: i64) -> HttpResponse {
    HttpResponse::Conflict().json(serde_json::json!({
        "error": "upload incomplete: object size mismatch",
        "code": "upload_incomplete",
        "expected_size": expected,
        "stored_size": actual,
    }))
}

fn verify_signed_byte_count(expected: i64, actual: i64) -> Result<(), HttpResponse> {
    media_validator::verify_upload_size_integrity(expected, actual)
        .map_err(|_| upload_incomplete_response(expected, actual))
}

pub fn direct_upload_public_base() -> String {
    std::env::var("DIRECT_UPLOAD_PUBLIC_BASE")
        .ok()
        .filter(|s| !s.trim().is_empty())
        .or_else(|| std::env::var("RAILWAY_PUBLIC_DOMAIN").ok().map(|d| format!("https://{}", d)))
        .unwrap_or_else(|| crate::db::media_public_base())
        .trim_end_matches('/')
        .to_string()
}

#[derive(Deserialize)]
pub struct SignUploadRequest {
    pub filename: String,
    #[serde(default, alias = "contentType")]
    pub content_type: Option<String>,
    #[serde(default, alias = "sizeBytes")]
    pub size_bytes: i64,
    pub title: Option<String>,
    pub description: Option<String>,
    pub category: Option<String>,
    #[serde(default, alias = "episodeId")]
    pub episode_id: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SignUploadResponse {
    pub upload_id: String,
    pub reel_id: String,
    pub upload_url: String,
    pub upload_token: String,
    pub storage_key: String,
    pub expires_at: String,
    pub max_bytes: i64,
}

#[derive(Deserialize)]
pub struct FinalizeReelRequest {
    #[serde(default, alias = "uploadId")]
    pub upload_id: String,
    pub title: Option<String>,
    pub description: Option<String>,
    pub category: Option<String>,
    #[serde(default, alias = "episodeId")]
    pub episode_id: Option<String>,
}

fn parse_upload_token(req: &HttpRequest) -> Option<String> {
    if let Some(raw) = req.headers().get("X-Upload-Token") {
        if let Ok(s) = raw.to_str() {
            let trimmed = s.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
    }
    let raw = req.headers().get(header::AUTHORIZATION)?.to_str().ok()?;
    let s = raw.trim();
    let prefix = "bearer ";
    if s.len() >= prefix.len() && s[..prefix.len()].eq_ignore_ascii_case(prefix) {
        let token = s[prefix.len()..].trim();
        if !token.is_empty() && !token.starts_with("rf_") {
            return Some(token.to_string());
        }
    }
    None
}

pub async fn sign_upload(
    store: web::Data<SignedUploadStore>,
    db_available: web::Data<bool>,
    body: web::Json<SignUploadRequest>,
) -> impl Responder {
    if !**db_available {
        return IngestionService::require_db_response();
    }

    store.purge_expired().await;

    if body.size_bytes <= 0 {
        return HttpResponse::BadRequest().json(serde_json::json!({
            "error": "sizeBytes must be positive"
        }));
    }
    if body.size_bytes > store.max_bytes {
        return HttpResponse::BadRequest().json(serde_json::json!({
            "error": format!("File exceeds signed upload limit ({} bytes)", store.max_bytes)
        }));
    }

    let ext = match ingestion::video_extension(&body.filename) {
        Some(e) => e,
        None => {
            return HttpResponse::BadRequest().json(serde_json::json!({
                "error": "Video must be .mp4 or .mov"
            }));
        }
    };

    let upload_id = Uuid::new_v4();
    let reel_id = Uuid::new_v4();
    let stored_name = format!("{}{}", reel_id, ext);
    let token = SignedUploadStore::new_token();
    let expires_at = SignedUploadStore::now_unix() + store.ttl_seconds;

    let session = PendingUpload {
        reel_id,
        token: token.clone(),
        stored_name: stored_name.clone(),
        original_filename: body.filename.clone(),
        content_type: body
            .content_type
            .clone()
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| ingestion::mime_for_ext(ext).to_string()),
        expected_size: body.size_bytes,
        title: body.title.clone(),
        description: body.description.clone(),
        category: body.category.clone(),
        episode_id: body
            .episode_id
            .clone()
            .filter(|s| !s.trim().is_empty()),
        expires_at,
        status: UploadStatus::Pending,
    };

    store.sessions.write().await.insert(upload_id, session);

    let content_type = body
        .content_type
        .clone()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| ingestion::mime_for_ext(ext).to_string());

    let upload_url = if let Some(r2) = crate::storage::r2::R2Storage::global() {
        match r2
            .presigned_put_url(&stored_name, &content_type, store.ttl_seconds as u64)
            .await
        {
            Ok(url) => url,
            Err(e) => {
                return HttpResponse::InternalServerError().json(serde_json::json!({ "error": e }));
            }
        }
    } else {
        let base = direct_upload_public_base();
        format!("{}/api/uploads/direct/{}", base, upload_id)
    };

    eprintln!(
        "[signed-upload] sign upload_id={} reel_id={} size={} file={} r2={}",
        upload_id,
        reel_id,
        body.size_bytes,
        body.filename,
        crate::storage::r2::R2Storage::enabled()
    );
    crate::video_pipeline_trace::trace(
        "sign",
        &body.filename,
        Some(body.size_bytes),
        &stored_name,
        "none",
        "signed",
        "",
    );

    HttpResponse::Ok().json(SignUploadResponse {
        upload_id: upload_id.to_string(),
        reel_id: reel_id.to_string(),
        upload_url,
        upload_token: token,
        storage_key: stored_name,
        expires_at: chrono::DateTime::from_timestamp(expires_at, 0)
            .map(|dt| dt.to_rfc3339())
            .unwrap_or_else(|| expires_at.to_string()),
        max_bytes: store.max_bytes,
    })
}

pub async fn direct_upload(
    path: web::Path<Uuid>,
    req: HttpRequest,
    mut payload: web::Payload,
    store: web::Data<SignedUploadStore>,
    videos_path: web::Data<VideosDir>,
) -> impl Responder {
    if crate::storage::r2::R2Storage::enabled() {
        return HttpResponse::Gone().json(serde_json::json!({
            "error": "Direct Railway upload disabled; use presigned R2 upload URL from /api/uploads/sign"
        }));
    }

    let upload_id = path.into_inner();
    let token = match parse_upload_token(&req) {
        Some(t) => t,
        None => {
            return HttpResponse::Unauthorized().json(serde_json::json!({
                "error": "missing_upload_token"
            }));
        }
    };

    store.purge_expired().await;

    let dest_path: PathBuf;
    let expected_size: i64;
    let max_bytes: i64;
    {
        let mut guard = store.sessions.write().await;
        let session = match guard.get_mut(&upload_id) {
            Some(s) => s,
            None => {
                return HttpResponse::NotFound().json(serde_json::json!({
                    "error": "Unknown or expired upload session"
                }));
            }
        };

        if session.status != UploadStatus::Pending {
            return HttpResponse::Conflict().json(serde_json::json!({
                "error": "Upload session is not accepting bytes"
            }));
        }
        if session.token != token {
            return HttpResponse::Unauthorized().json(serde_json::json!({
                "error": "invalid_upload_token"
            }));
        }
        if SignedUploadStore::now_unix() > session.expires_at {
            guard.remove(&upload_id);
            return HttpResponse::Gone().json(serde_json::json!({
                "error": "Upload session expired"
            }));
        }

        expected_size = session.expected_size;
        max_bytes = store.max_bytes;
        dest_path = videos_path.0.join(&session.stored_name);
    }

    let tmp_path = dest_path.with_extension("partial");
    let mut file = match tokio::fs::File::create(&tmp_path).await {
        Ok(f) => f,
        Err(e) => {
            return HttpResponse::InternalServerError().json(serde_json::json!({
                "error": format!("Failed to open upload destination: {}", e)
            }));
        }
    };

    let mut total: u64 = 0;
    while let Some(chunk) = payload.next().await {
        let data = match chunk {
            Ok(d) => d,
            Err(e) => {
                let _ = tokio::fs::remove_file(&tmp_path).await;
                return HttpResponse::BadRequest().body(format!("Read error: {}", e));
            }
        };
        total += data.len() as u64;
        if total > max_bytes as u64 {
            let _ = tokio::fs::remove_file(&tmp_path).await;
            return HttpResponse::PayloadTooLarge().json(serde_json::json!({
                "error": format!("Upload exceeds signed upload limit ({} bytes)", max_bytes)
            }));
        }
        if let Err(e) = file.write_all(&data).await {
            let _ = tokio::fs::remove_file(&tmp_path).await;
            return HttpResponse::InternalServerError().json(serde_json::json!({
                "error": format!("Write failed: {}", e)
            }));
        }
    }
    if let Err(e) = file.flush().await {
        let _ = tokio::fs::remove_file(&tmp_path).await;
        return HttpResponse::InternalServerError().json(serde_json::json!({
            "error": format!("Flush failed: {}", e)
        }));
    }

    if let Err(resp) = verify_signed_byte_count(expected_size, total as i64) {
        let _ = tokio::fs::remove_file(&tmp_path).await;
        return resp;
    }

    if let Err(e) = tokio::fs::rename(&tmp_path, &dest_path).await {
        let _ = tokio::fs::remove_file(&tmp_path).await;
        return HttpResponse::InternalServerError().json(serde_json::json!({
            "error": format!("Failed to finalize upload file: {}", e)
        }));
    }

    {
        let mut guard = store.sessions.write().await;
        if let Some(session) = guard.get_mut(&upload_id) {
            session.status = UploadStatus::Uploaded;
        }
    }

    eprintln!(
        "[signed-upload] direct stored upload_id={} path={} bytes={}",
        upload_id,
        dest_path.display(),
        total
    );

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "uploadId": upload_id.to_string(),
        "bytes": total,
        "storageKey": dest_path
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("")
    }))
}

pub async fn finalize_reel(
    store: web::Data<SignedUploadStore>,
    db: web::Data<Pool<Postgres>>,
    db_available: web::Data<bool>,
    videos_path: web::Data<VideosDir>,
    thumbs_path: web::Data<ThumbsDir>,
    event_bus: web::Data<EventBus>,
    body: web::Json<FinalizeReelRequest>,
) -> impl Responder {
    if !**db_available {
        return IngestionService::require_db_response();
    }

    let upload_id = match Uuid::parse_str(body.upload_id.trim()) {
        Ok(id) => id,
        Err(_) => {
            return HttpResponse::BadRequest().json(serde_json::json!({
                "error": "Invalid uploadId"
            }));
        }
    };

    store.purge_expired().await;

    let pending = {
        let guard = store.sessions.read().await;
        match guard.get(&upload_id) {
            Some(s) => (
                s.status,
                s.stored_name.clone(),
                s.expected_size,
                s.reel_id,
                s.original_filename.clone(),
                s.title.clone(),
                s.description.clone(),
                s.category.clone(),
                s.episode_id.clone(),
            ),
            None => {
                return HttpResponse::NotFound().json(serde_json::json!({
                    "error": "Unknown or expired upload session"
                }));
            }
        }
    };

    let (
        status,
        stored_name,
        expected_size,
        reel_id,
        original_filename,
        session_title,
        session_description,
        session_category,
        session_episode_id,
    ) = pending;

    let object_key = crate::storage::r2::R2Storage::global()
        .map(|r2| r2.object_key(&stored_name))
        .unwrap_or_else(|| stored_name.clone());

    if status == UploadStatus::Uploaded {
        let disk_path = videos_path.0.join(&stored_name);
        let stored_size = match tokio::fs::metadata(&disk_path).await {
            Ok(meta) => meta.len() as i64,
            Err(e) => {
                return HttpResponse::Conflict().json(serde_json::json!({
                    "error": format!("Uploaded video file missing before finalize: {}", e)
                }));
            }
        };
        if let Err(resp) = verify_signed_byte_count(expected_size, stored_size) {
            eprintln!(
                "[R2_VERIFY_TRACE] key={} expectedSize={} r2ObjectSize={} contentLength={} finalizeAllowed=false",
                object_key, expected_size, stored_size, stored_size
            );
            eprintln!(
                "[BG7X_FINALIZE] uploadId={} objectKey={} r2HeadOk=skipped sessionStatus=Uploaded storedSize={} signedSize={} ingestionStatus=upload_incomplete",
                upload_id, object_key, stored_size, expected_size
            );
            crate::video_pipeline_trace::trace(
                "finalize_verify",
                &original_filename,
                Some(expected_size),
                &object_key,
                "uploaded",
                "upload_incomplete",
                format!("disk size mismatch expected={} actual={}", expected_size, stored_size),
            );
            let _ = tokio::fs::remove_file(&disk_path).await;
            return resp;
        }
        eprintln!(
            "[R2_VERIFY_TRACE] key={} expectedSize={} r2ObjectSize={} contentLength={} finalizeAllowed=true",
            object_key, expected_size, stored_size, stored_size
        );
        crate::video_pipeline_trace::trace(
            "finalize_verify",
            &original_filename,
            Some(expected_size),
            &object_key,
            "uploaded",
            "size_ok",
            "",
        );
        eprintln!(
            "[BG7X_FINALIZE] uploadId={} objectKey={} r2HeadOk=skipped sessionStatus=Uploaded storedSize={} signedSize={} ingestionStatus=disk_verified",
            upload_id, object_key, stored_size, expected_size
        );
    } else if crate::storage::r2::R2Storage::enabled() {
        let r2 = crate::storage::r2::R2Storage::global().expect("r2 enabled");
        let head = match r2.head_object(&stored_name).await {
            Ok(h) => h,
            Err(e) => {
                eprintln!(
                    "[BG7X_FINALIZE] uploadId={} objectKey={} r2HeadOk=false r2HeadError={} objectSize=-1 contentType= ingestionStatus=conflict",
                    upload_id, object_key, e
                );
                return HttpResponse::Conflict().json(serde_json::json!({
                    "error": format!("Upload not found in R2: {}", e)
                }));
            }
        };
        if head.content_length <= 0 {
            eprintln!(
                "[R2_VERIFY_TRACE] key={} expectedSize={} r2ObjectSize=0 contentLength=0 finalizeAllowed=false reason=empty",
                object_key, expected_size
            );
            eprintln!(
                "[BG7X_FINALIZE] uploadId={} objectKey={} r2HeadOk=true objectSize=0 contentType={} ingestionStatus=conflict_empty",
                upload_id,
                object_key,
                head.content_type.as_deref().unwrap_or("")
            );
            return HttpResponse::Conflict().json(serde_json::json!({
                "error": "Upload bytes must be stored before finalize"
            }));
        }
        eprintln!(
            "[R2_VERIFY_TRACE] key={} expectedSize={} r2ObjectSize={} contentLength={} contentType={} finalizeAllowed={}",
            object_key,
            expected_size,
            head.content_length,
            head.content_length,
            head.content_type.as_deref().unwrap_or(""),
            expected_size == head.content_length
        );
        if let Err(resp) = verify_signed_byte_count(expected_size, head.content_length) {
            eprintln!(
                "[BG7X_FINALIZE] uploadId={} objectKey={} r2HeadOk=true objectSize={} contentType={} ingestionStatus=upload_incomplete signedSize={}",
                upload_id,
                object_key,
                head.content_length,
                head.content_type.as_deref().unwrap_or(""),
                expected_size
            );
            crate::video_pipeline_trace::trace(
                "finalize_verify",
                &original_filename,
                Some(expected_size),
                &object_key,
                "uploaded",
                "upload_incomplete",
                format!(
                    "R2 size mismatch expected={} actual={}",
                    expected_size, head.content_length
                ),
            );
            return resp;
        }
        crate::video_pipeline_trace::trace(
            "finalize_verify",
            &original_filename,
            Some(expected_size),
            &object_key,
            "uploaded",
            "size_ok",
            "",
        );
        eprintln!(
            "[BG7X_FINALIZE] uploadId={} objectKey={} r2HeadOk=true objectSize={} contentType={} ingestionStatus=r2_verified",
            upload_id,
            object_key,
            head.content_length,
            head.content_type.as_deref().unwrap_or("")
        );
    } else {
        eprintln!(
            "[BG7X_FINALIZE] uploadId={} objectKey={} r2HeadOk=false objectSize=-1 contentType= ingestionStatus=conflict_not_uploaded",
            upload_id, object_key
        );
        return HttpResponse::Conflict().json(serde_json::json!({
            "error": "Upload bytes must be stored before finalize"
        }));
    }

    {
        let mut guard = store.sessions.write().await;
        let session = match guard.get_mut(&upload_id) {
            Some(s) => s,
            None => {
                return HttpResponse::NotFound().json(serde_json::json!({
                    "error": "Unknown or expired upload session"
                }));
            }
        };
        session.status = UploadStatus::Finalized;
    }

    let svc = IngestionService::new(
        db.get_ref().clone(),
        videos_path.get_ref().clone(),
        thumbs_path.get_ref().clone(),
        event_bus.get_ref().clone(),
    );

    let title = body
        .title
        .clone()
        .or(session_title)
        .filter(|s| !s.trim().is_empty());
    let description = body
        .description
        .clone()
        .or(session_description)
        .filter(|s| !s.trim().is_empty());
    let category = body
        .category
        .clone()
        .or(session_category)
        .filter(|s| !s.trim().is_empty());
    let episode_id = body
        .episode_id
        .clone()
        .or(session_episode_id)
        .filter(|s| !s.trim().is_empty());

    eprintln!(
        "[signed-upload] finalize upload_id={} reel_id={} file={}",
        upload_id, reel_id, stored_name
    );
    crate::video_pipeline_trace::trace(
        "finalize_ingest",
        &original_filename,
        Some(expected_size),
        &stored_name,
        "size_ok",
        "pending_enqueue",
        "",
    );

    let response = ingestion::upload::ingest_stored_video(
        &svc,
        reel_id,
        &stored_name,
        &original_filename,
        title,
        description,
        category,
        episode_id,
        Some(expected_size),
    )
    .await;

    eprintln!(
        "[BG7X_FINALIZE] uploadId={} objectKey={} r2HeadOk=true objectSize={} contentType= ingestionStatus={}",
        upload_id,
        object_key,
        expected_size,
        response.status().as_u16()
    );

    response
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Mutex, OnceLock};

    fn env_lock() -> &'static Mutex<()> {
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| Mutex::new(()))
    }

    #[test]
    fn signed_upload_default_limit_is_two_gib_without_env_override() {
        let _guard = env_lock().lock().expect("env lock poisoned");
        let prior = std::env::var("SIGNED_UPLOAD_MAX_BYTES").ok();
        std::env::remove_var("SIGNED_UPLOAD_MAX_BYTES");
        let store = SignedUploadStore::from_env();
        assert_eq!(store.max_bytes, 2_147_483_648);
        if let Some(value) = prior {
            std::env::set_var("SIGNED_UPLOAD_MAX_BYTES", value);
        }
    }

    #[test]
    fn signed_upload_limit_honors_env_override() {
        let _guard = env_lock().lock().expect("env lock poisoned");
        let prior = std::env::var("SIGNED_UPLOAD_MAX_BYTES").ok();
        std::env::set_var("SIGNED_UPLOAD_MAX_BYTES", "123456789");
        let store = SignedUploadStore::from_env();
        assert_eq!(store.max_bytes, 123_456_789);
        if let Some(value) = prior {
            std::env::set_var("SIGNED_UPLOAD_MAX_BYTES", value);
        } else {
            std::env::remove_var("SIGNED_UPLOAD_MAX_BYTES");
        }
    }

    #[test]
    fn around_nine_hundred_mb_sources_pass_default_admission_threshold() {
        let _guard = env_lock().lock().expect("env lock poisoned");
        let prior = std::env::var("SIGNED_UPLOAD_MAX_BYTES").ok();
        std::env::remove_var("SIGNED_UPLOAD_MAX_BYTES");
        let store = SignedUploadStore::from_env();
        assert!(852_575_217 <= store.max_bytes);
        assert!(903_238_844 <= store.max_bytes);
        if let Some(value) = prior {
            std::env::set_var("SIGNED_UPLOAD_MAX_BYTES", value);
        }
    }
}
