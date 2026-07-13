use actix_multipart::Multipart;
use actix_web::{web, HttpResponse, Responder};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use sqlx::{Pool, Postgres};
use uuid::Uuid;

use crate::handlers;
use crate::media_seed;
use crate::media_validator;
use crate::reel_contract::{upload_image, upload_video, UploadResponse};
use crate::video_stream::{ThumbsDir, VideosDir};

const ALL_UPLOAD_FIELDS: &[&str] = &["video", "file", "image", "thumbnail"];

#[derive(Serialize)]
pub struct MediaValidationResponse {
    pub valid: bool,
    pub kind: String,
    pub filename: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    pub checks: MediaValidationChecks,
}

#[derive(Serialize)]
pub struct MediaValidationChecks {
    pub container_or_image: bool,
    pub not_html: bool,
    pub ffprobe_or_image: bool,
}

#[derive(Serialize)]
pub struct MediaStorageResponse {
    pub videos: Vec<String>,
    pub thumbnails: Vec<String>,
    pub invalid_videos: Vec<InvalidVideoEntry>,
}

#[derive(Serialize)]
pub struct InvalidVideoEntry {
    pub name: String,
    pub reason: String,
}

/// Keep original basename; reject path traversal only.
fn safe_original_filename(original: &str) -> Result<String, String> {
    let name = std::path::Path::new(original)
        .file_name()
        .and_then(|s| s.to_str())
        .ok_or_else(|| "Invalid filename".to_string())?;

    if name.is_empty()
        || name == "."
        || name == ".."
        || name.contains('/')
        || name.contains('\\')
        || name.contains('\0')
    {
        return Err("Invalid filename".to_string());
    }

    Ok(name.to_string())
}

fn is_image_field(field_name: &str) -> bool {
    field_name == "image" || field_name == "thumbnail"
}

pub fn is_image_filename(filename: &str) -> bool {
    let lower = filename.to_lowercase();
    lower.ends_with(".jpg")
        || lower.ends_with(".jpeg")
        || lower.ends_with(".png")
        || lower.ends_with(".webp")
        || lower.ends_with(".gif")
}

pub fn validate_bytes_for_video(bytes: &[u8], filename: &str) -> Result<(), String> {
    media_validator::validate_video_bytes(bytes, filename)
        .map(|_| ())
        .map_err(|e| e.to_string())
}

pub fn validate_bytes_for_image(bytes: &[u8], filename: &str) -> Result<(), String> {
    validate_bytes_for_image_inner(bytes, filename)
}

fn validate_bytes_for_image_inner(bytes: &[u8], filename: &str) -> Result<(), String> {
    let not_html = !media_validator::is_html_or_text_disguise(bytes);

    if !not_html {
        return Err("Invalid image file: HTML disguised as image".to_string());
    }
    if !media_seed::is_valid_image_bytes(bytes) {
        return Err(
            "Invalid image file: must be JPEG (FF D8), PNG (89 50 4E 47), GIF, or WebP".to_string(),
        );
    }
    let _ = filename;
    Ok(())
}

fn validate_bytes(
    is_image: bool,
    bytes: &[u8],
    filename: &str,
) -> Result<MediaValidationChecks, String> {
    if is_image {
        validate_bytes_for_image_inner(bytes, filename)?;
        return Ok(MediaValidationChecks {
            container_or_image: true,
            not_html: true,
            ffprobe_or_image: true,
        });
    }

    let not_html = !media_validator::is_html_or_text_disguise(bytes);
    if !not_html {
        return Err("Invalid video file: HTML/text disguised as video".to_string());
    }

    if !media_validator::is_valid_video_container(bytes) {
        return Err("Invalid video file: MP4/MOV must have 'ftyp' at bytes 4-7".to_string());
    }

    media_validator::validate_video_bytes(bytes, filename).map_err(|e| e.to_string())?;

    Ok(MediaValidationChecks {
        container_or_image: true,
        not_html: true,
        ffprobe_or_image: true,
    })
}

async fn read_multipart_upload(
    payload: &mut Multipart,
    allowed_fields: &[&str],
) -> Result<(String, String, Vec<u8>), HttpResponse> {
    let mut seen_fields: Vec<String> = Vec::new();

    while let Some(item) = payload.next().await {
        let mut field = match item {
            Ok(f) => f,
            Err(e) => {
                return Err(HttpResponse::BadRequest().body(format!("Multipart error: {}", e)));
            }
        };

        let field_name = field
            .content_disposition()
            .and_then(|cd| cd.get_name().map(|s| s.to_string()))
            .unwrap_or_default();

        seen_fields.push(field_name.clone());

        if !allowed_fields.contains(&field_name.as_str()) {
            continue;
        }

        let original = field
            .content_disposition()
            .and_then(|cd| cd.get_filename().map(|s| s.to_string()))
            .unwrap_or_else(|| format!("upload_{}.bin", Uuid::new_v4()));

        let filename = match safe_original_filename(&original) {
            Ok(name) => name,
            Err(reason) => {
                return Err(HttpResponse::BadRequest().json(serde_json::json!({
                    "error": reason
                })));
            }
        };

        let mut bytes = Vec::new();
        while let Some(chunk) = field.next().await {
            match chunk {
                Ok(data) => bytes.extend_from_slice(&data),
                Err(e) => {
                    return Err(HttpResponse::BadRequest().body(format!("Read error: {}", e)));
                }
            }
        }

        return Ok((field_name, filename, bytes));
    }

    Err(HttpResponse::BadRequest().json(serde_json::json!({
        "error": "No file field found",
        "expected_fields": allowed_fields,
        "received_fields": seen_fields
    })))
}

fn save_upload(
    filename: &str,
    bytes: &[u8],
    is_image: bool,
    videos_path: &VideosDir,
    thumbs_path: &ThumbsDir,
) -> Result<UploadResponse, HttpResponse> {
    let dest_dir = if is_image {
        &thumbs_path.0
    } else {
        &videos_path.0
    };

    let dest = dest_dir.join(filename);
    if let Err(e) = std::fs::write(&dest, bytes) {
        return Err(HttpResponse::InternalServerError().body(format!("Write failed: {}", e)));
    }

    let size = bytes.len() as u64;
    let url = if is_image {
        format!("/thumbs/{}", filename)
    } else {
        format!("/videos/{}", filename)
    };

    Ok(if is_image {
        upload_image(filename, &url, size)
    } else {
        upload_video(filename, &url, size)
    })
}

pub async fn multipart_upload(
    payload: &mut Multipart,
    videos_path: web::Data<VideosDir>,
    thumbs_path: web::Data<ThumbsDir>,
    allowed_fields: &[&str],
    force_kind: Option<&str>,
) -> HttpResponse {
    let (field_name, filename, bytes) = match read_multipart_upload(payload, allowed_fields).await {
        Ok(v) => v,
        Err(resp) => return resp,
    };

    let is_image = match force_kind {
        Some("image") => true,
        Some("video") => false,
        _ => is_image_field(&field_name) || is_image_filename(&filename),
    };

    if let Err(reason) = validate_bytes(is_image, &bytes, &filename) {
        eprintln!("⚠️ Upload rejected: {} — {}", filename, reason);
        return HttpResponse::BadRequest().json(serde_json::json!({ "error": reason }));
    }

    match save_upload(&filename, &bytes, is_image, &videos_path, &thumbs_path) {
        Ok(response) => HttpResponse::Ok().json(response),
        Err(resp) => resp,
    }
}

pub async fn multipart_validate(payload: &mut Multipart, allowed_fields: &[&str]) -> HttpResponse {
    let (field_name, filename, bytes) = match read_multipart_upload(payload, allowed_fields).await {
        Ok(v) => v,
        Err(resp) => return resp,
    };

    let is_image = is_image_field(&field_name) || is_image_filename(&filename);
    let kind = if is_image { "image" } else { "video" }.to_string();

    match validate_bytes(is_image, &bytes, &filename) {
        Ok(checks) => HttpResponse::Ok().json(MediaValidationResponse {
            valid: true,
            kind,
            filename,
            error: None,
            checks,
        }),
        Err(reason) => HttpResponse::Ok().json(MediaValidationResponse {
            valid: false,
            kind,
            filename,
            error: Some(reason.clone()),
            checks: MediaValidationChecks {
                container_or_image: false,
                not_html: !media_seed::is_html_or_text_disguise(&bytes),
                ffprobe_or_image: false,
            },
        }),
    }
}

/// Parsed multipart fields for POST /api/reels.
pub struct ParsedReelForm {
    pub title: Option<String>,
    pub description: Option<String>,
    pub category: Option<String>,
    pub video: Option<(String, Vec<u8>)>,
    pub thumbnail: Option<(String, Vec<u8>)>,
}

/// Read all multipart parts (video, thumbnail/image, title, description, category).
pub async fn parse_reel_multipart(payload: &mut Multipart) -> Result<ParsedReelForm, HttpResponse> {
    crate::pipeline_diag::pipeline_diag(
        "MEDIA_API",
        "parse_reel_multipart",
        "media_api.rs",
        None,
        None,
        "enter",
    );
    let mut form = ParsedReelForm {
        title: None,
        description: None,
        category: None,
        video: None,
        thumbnail: None,
    };

    while let Some(item) = payload.next().await {
        let mut field = match item {
            Ok(f) => f,
            Err(e) => {
                return Err(HttpResponse::BadRequest().body(format!("Multipart error: {}", e)));
            }
        };

        let field_name = field
            .content_disposition()
            .and_then(|cd| cd.get_name().map(|s| s.to_string()))
            .unwrap_or_default();

        let mut bytes = Vec::new();
        while let Some(chunk) = field.next().await {
            match chunk {
                Ok(data) => bytes.extend_from_slice(&data),
                Err(e) => {
                    return Err(HttpResponse::BadRequest().body(format!("Read error: {}", e)));
                }
            }
        }

        match field_name.as_str() {
            "video" | "file" if form.video.is_none() && !bytes.is_empty() => {
                let original = field
                    .content_disposition()
                    .and_then(|cd| cd.get_filename().map(|s| s.to_string()))
                    .unwrap_or_else(|| format!("upload_{}.mp4", Uuid::new_v4()));
                let filename = match safe_original_filename(&original) {
                    Ok(name) => name,
                    Err(reason) => {
                        return Err(HttpResponse::BadRequest().json(serde_json::json!({
                            "error": reason
                        })));
                    }
                };
                if let Err(reason) = validate_bytes(false, &bytes, &filename) {
                    return Err(
                        HttpResponse::BadRequest().json(serde_json::json!({ "error": reason }))
                    );
                }
                form.video = Some((filename, bytes));
            }
            "thumbnail" | "image" if form.thumbnail.is_none() && !bytes.is_empty() => {
                let original = field
                    .content_disposition()
                    .and_then(|cd| cd.get_filename().map(|s| s.to_string()))
                    .unwrap_or_else(|| format!("upload_{}.jpg", Uuid::new_v4()));
                let filename = match safe_original_filename(&original) {
                    Ok(name) => name,
                    Err(reason) => {
                        return Err(HttpResponse::BadRequest().json(serde_json::json!({
                            "error": reason
                        })));
                    }
                };
                if let Err(reason) = validate_bytes(true, &bytes, &filename) {
                    return Err(
                        HttpResponse::BadRequest().json(serde_json::json!({ "error": reason }))
                    );
                }
                form.thumbnail = Some((filename, bytes));
            }
            "title" => {
                form.title = Some(String::from_utf8_lossy(&bytes).trim().to_string());
            }
            "description" => {
                form.description = Some(String::from_utf8_lossy(&bytes).trim().to_string());
            }
            "category" => {
                form.category = Some(String::from_utf8_lossy(&bytes).trim().to_string());
            }
            _ => {}
        }
    }

    let video_name = form.video.as_ref().map(|(n, _)| n.as_str());
    let thumb_name = form.thumbnail.as_ref().map(|(n, _)| n.as_str());
    crate::pipeline_diag::pipeline_diag(
        "MEDIA_API",
        "parse_reel_multipart",
        "media_api.rs",
        None,
        video_name.or(thumb_name),
        "parsed_ok",
    );

    Ok(form)
}

pub fn write_media_file(
    dest_dir: &std::path::Path,
    filename: &str,
    bytes: &[u8],
) -> Result<(), HttpResponse> {
    let dest = dest_dir.join(filename);
    std::fs::write(&dest, bytes)
        .map_err(|e| HttpResponse::InternalServerError().body(format!("Write failed: {}", e)))?;
    Ok(())
}

pub async fn read_first_upload_file(
    payload: &mut Multipart,
    allowed_fields: &[&str],
) -> Result<(String, String, Vec<u8>), HttpResponse> {
    read_multipart_upload(payload, allowed_fields).await
}

pub async fn media_upload(
    mut payload: Multipart,
    videos_path: web::Data<VideosDir>,
    thumbs_path: web::Data<ThumbsDir>,
    db: web::Data<Pool<Postgres>>,
    db_available: web::Data<bool>,
    event_bus: web::Data<crate::events::EventBus>,
) -> impl Responder {
    eprintln!("📥 POST /api/media/upload");

    if !**db_available {
        return crate::ingestion::IngestionService::require_db_response();
    }

    let (field_name, filename, bytes) =
        match read_multipart_upload(&mut payload, ALL_UPLOAD_FIELDS).await {
            Ok(v) => v,
            Err(resp) => return resp,
        };
    let svc = crate::ingestion::IngestionService::new(
        db.get_ref().clone(),
        videos_path.get_ref().clone(),
        thumbs_path.get_ref().clone(),
        event_bus.get_ref().clone(),
    );
    crate::ingestion::upload::ingest_from_media_upload(&svc, &field_name, &filename, &bytes).await
}

pub async fn media_validate(mut payload: Multipart) -> impl Responder {
    eprintln!("📥 POST /api/media/validate");
    multipart_validate(&mut payload, ALL_UPLOAD_FIELDS).await
}

pub async fn media_storage(
    db: web::Data<Pool<Postgres>>,
    db_available: web::Data<bool>,
    videos_path: web::Data<VideosDir>,
    thumbs_path: web::Data<ThumbsDir>,
) -> impl Responder {
    let (videos, thumbnails, source) = if **db_available {
        match (
            crate::db::reels::list_ready_video_basenames(db.get_ref()).await,
            crate::db::reels::list_ready_thumbnail_basenames(db.get_ref()).await,
        ) {
            (Ok(v), Ok(t)) => (v, t, "postgres"),
            (Err(e), _) | (_, Err(e)) => {
                return HttpResponse::InternalServerError().json(serde_json::json!({
                    "error": e.to_string()
                }));
            }
        }
    } else {
        (
            media_seed::list_media_files(&videos_path.0, "videos"),
            media_seed::list_media_files(&thumbs_path.0, "thumbs"),
            "filesystem-admin",
        )
    };

    let invalid_videos: Vec<InvalidVideoEntry> = media_seed::scan_invalid_videos(&videos_path.0)
        .into_iter()
        .map(|(name, reason)| InvalidVideoEntry { name, reason })
        .collect();

    eprintln!(
        "GET /api/media/storage — {} videos, {} thumbs, {} invalid [{}]",
        videos.len(),
        thumbnails.len(),
        invalid_videos.len(),
        source
    );

    HttpResponse::Ok().json(MediaStorageResponse {
        videos,
        thumbnails,
        invalid_videos,
    })
}

#[derive(Debug, Deserialize)]
pub struct OrphanCleanupQuery {
    /// Set `confirm=true` on POST to delete files. GET always previews only.
    pub confirm: Option<bool>,
}

async fn reels_for_cleanup(
    db: web::Data<Pool<Postgres>>,
    db_available: web::Data<bool>,
) -> Vec<crate::db::reels::ReelRow> {
    handlers::fetch_reels_for_cleanup(db, db_available).await
}

pub async fn media_cleanup_orphans_get(
    db: web::Data<Pool<Postgres>>,
    db_available: web::Data<bool>,
    videos_path: web::Data<VideosDir>,
    thumbs_path: web::Data<ThumbsDir>,
) -> impl Responder {
    let reels = reels_for_cleanup(db, db_available).await;
    let report = media_seed::scan_orphan_media(&videos_path.0, &thumbs_path.0, &reels);
    eprintln!(
        "GET /api/media/cleanup/orphans — {} thumb orphans, {} video orphans, {} fake thumbs",
        report.orphan_thumbs.len(),
        report.orphan_videos.len(),
        report.fake_thumbs.len()
    );
    HttpResponse::Ok().json(report)
}

pub async fn media_cleanup_orphans_post(
    query: web::Query<OrphanCleanupQuery>,
    db: web::Data<Pool<Postgres>>,
    db_available: web::Data<bool>,
    videos_path: web::Data<VideosDir>,
    thumbs_path: web::Data<ThumbsDir>,
) -> impl Responder {
    let reels = reels_for_cleanup(db, db_available).await;

    if !query.confirm.unwrap_or(false) {
        let report = media_seed::scan_orphan_media(&videos_path.0, &thumbs_path.0, &reels);
        return HttpResponse::BadRequest().json(serde_json::json!({
            "error": "Destructive cleanup requires confirm=true",
            "hint": "POST /api/media/cleanup/orphans?confirm=true",
            "preview": report
        }));
    }

    let report = media_seed::delete_orphan_media(&videos_path.0, &thumbs_path.0, &reels);
    eprintln!(
        "POST /api/media/cleanup/orphans — deleted {} files ({} errors)",
        report.deleted_count,
        report.errors.len()
    );
    HttpResponse::Ok().json(report)
}

pub async fn media_storage_delete(
    path: web::Path<String>,
    videos_path: web::Data<VideosDir>,
    thumbs_path: web::Data<ThumbsDir>,
) -> impl Responder {
    let filename = path.into_inner();
    eprintln!("DELETE /api/media/storage/{}", filename);

    let video_path = videos_path.0.join(&filename);
    let thumb_path = thumbs_path.0.join(&filename);

    let mut deleted = false;
    if video_path.exists() {
        deleted = std::fs::remove_file(&video_path).is_ok();
    }
    if thumb_path.exists() {
        deleted = std::fs::remove_file(&thumb_path).is_ok() || deleted;
    }

    if deleted {
        HttpResponse::Ok().json(serde_json::json!({ "success": true }))
    } else {
        HttpResponse::Ok()
            .json(serde_json::json!({ "success": true, "note": "file not found locally" }))
    }
}
