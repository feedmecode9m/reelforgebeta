use actix_multipart::Multipart;
use actix_web::HttpResponse;
use uuid::Uuid;

use crate::db::{self, jobs, reels};
use crate::media_api;
use crate::media_validator;
use crate::reel_contract;

use super::{mime_for_ext, video_extension, IngestionService};

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IngestAcceptedResponse {
    pub id: String,
    pub status: &'static str,
    pub video_url: String,
    pub thumbnail_url: Option<String>,
    pub poll_url: String,
}

fn asset_filename(asset_id: Uuid, ext: &str) -> String {
    format!("{}{}", asset_id, ext)
}

async fn ingest_video_bytes(
    svc: &IngestionService,
    bytes: &[u8],
    original_filename: &str,
    title: Option<String>,
    description: Option<String>,
    category: Option<String>,
    user_thumbnail: Option<(String, Vec<u8>)>,
) -> HttpResponse {
    let ext = match video_extension(original_filename) {
        Some(e) => e,
        None => {
            return HttpResponse::BadRequest().json(serde_json::json!({
                "error": "Video must be .mp4 or .mov"
            }));
        }
    };

    if let Err(reason) = media_api::validate_bytes_for_video(bytes, original_filename) {
        return HttpResponse::BadRequest().json(serde_json::json!({ "error": reason }));
    }

    let asset_id = Uuid::new_v4();
    let stored_name = asset_filename(asset_id, ext);
    crate::pipeline_diag::pipeline_diag(
        "INGEST",
        "ingest_video_bytes",
        "upload.rs",
        Some(&asset_id.to_string()),
        Some(original_filename),
        "asset_created",
    );
    let video_path = svc.config.videos_path.join(&stored_name);

    if let Err(e) = std::fs::write(&video_path, bytes) {
        return HttpResponse::InternalServerError().json(serde_json::json!({
            "error": format!("Failed to store video: {}", e)
        }));
    }
    eprintln!(
        "[STORE_WRITE] kind=video path={} bytes={}",
        video_path.display(),
        bytes.len()
    );

    // Post-write verification — quarantine if disk copy is corrupt.
    if let Err(err) = media_validator::validate_video_path(&video_path) {
        let _ = media_validator::quarantine_video(&svc.config.videos_path, &video_path, &err);
        return HttpResponse::BadRequest().json(serde_json::json!({
            "error": err.to_string()
        }));
    }

    let video_url = format!("/videos/{}", stored_name);
    let mut thumb_url: Option<String> = None;

    if let Some((thumb_name, thumb_bytes)) = user_thumbnail {
        if media_api::validate_bytes_for_image(&thumb_bytes, &thumb_name).is_ok() {
            let thumb_stored = format!("{}.jpg", asset_id);
            let thumb_path = svc.config.thumbs_path.join(&thumb_stored);
            if std::fs::write(&thumb_path, &thumb_bytes).is_ok() {
                thumb_url = Some(format!("/thumbs/{}", thumb_stored));
                eprintln!(
                    "[STORE_WRITE] kind=thumbnail path={} bytes={}",
                    thumb_path.display(),
                    thumb_bytes.len()
                );
            }
        }
    }

    let title = title
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| reel_contract::display_name_from_filename(&stored_name));
    let category = category
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| "Trending".to_string());

    let file_size = bytes.len() as i64;
    let mime = mime_for_ext(ext);

    if let Err(e) = reels::insert_pending_reel(
        &svc.pool,
        asset_id,
        &title,
        &category,
        description.as_deref(),
        &video_url,
        thumb_url.as_deref(),
        &stored_name,
        file_size,
        Some(mime),
    )
    .await
    {
        let _ = std::fs::remove_file(&video_path);
        crate::pipeline_diag::pipeline_diag(
            "DB",
            "ingest_video_bytes",
            "upload.rs",
            Some(&asset_id.to_string()),
            Some(original_filename),
            "insert_failed",
        );
        crate::pipeline_diag::pipeline_diag(
            "RESPONSE",
            "ingest_video_bytes",
            "upload.rs",
            Some(&asset_id.to_string()),
            Some(original_filename),
            "500_db_insert_failed",
        );
        return HttpResponse::InternalServerError().json(serde_json::json!({
            "error": format!("Database insert failed: {}", e)
        }));
    }
    crate::pipeline_diag::pipeline_diag(
        "DB",
        "ingest_video_bytes",
        "upload.rs",
        Some(&asset_id.to_string()),
        Some(&stored_name),
        "insert_pending_ok",
    );

    // Skip ffmpeg job if user supplied a valid thumbnail
    let needs_thumb_job = thumb_url.is_none();
    if needs_thumb_job {
        if let Err(e) = jobs::enqueue(&svc.pool, asset_id).await {
            let _ = reels::mark_failed(&svc.pool, asset_id, &e.to_string()).await;
            return HttpResponse::InternalServerError().json(serde_json::json!({
                "error": format!("Failed to enqueue ingestion job: {}", e)
            }));
        }
        eprintln!("[STORE_UPDATE] reel={} status=pending queue=enqueued", asset_id);
        crate::pipeline_diag::pipeline_diag(
            "INGEST",
            "ingest_video_bytes",
            "upload.rs",
            Some(&asset_id.to_string()),
            Some(&stored_name),
            "pending_enqueued",
        );
    } else {
        if let Err(e) = reels::mark_ready(&svc.pool, asset_id, thumb_url.as_ref().unwrap()).await {
            return HttpResponse::InternalServerError().json(serde_json::json!({
                "error": format!("Failed to mark reel ready: {}", e)
            }));
        }
        eprintln!("[STORE_UPDATE] reel={} status=ready immediate=true", asset_id);
        crate::pipeline_diag::pipeline_diag(
            "DB",
            "ingest_video_bytes",
            "upload.rs",
            Some(&asset_id.to_string()),
            Some(&stored_name),
            "mark_ready_immediate",
        );
        reel_contract::publish_reel_ready(&svc.pool, asset_id, svc.event_bus.as_ref()).await;
    }

    let abs_video = db::canonical_media_url(&video_url);
    let abs_thumb = thumb_url.as_ref().map(|p| db::canonical_media_url(p));

    eprintln!(
        "[ingest] accepted reel={} file={} thumb_job={}",
        asset_id, stored_name, needs_thumb_job
    );
    let status = if needs_thumb_job { "pending" } else { "ready" };
    crate::pipeline_diag::pipeline_diag(
        "RESPONSE",
        "ingest_video_bytes",
        "upload.rs",
        Some(&asset_id.to_string()),
        Some(&stored_name),
        status,
    );

    HttpResponse::Accepted().json(IngestAcceptedResponse {
        id: asset_id.to_string(),
        status,
        video_url: abs_video,
        thumbnail_url: abs_thumb,
        poll_url: format!("/api/reels/{}", asset_id),
    })
}

pub async fn ingest_from_reel_multipart(
    svc: &IngestionService,
    payload: &mut Multipart,
) -> HttpResponse {
    crate::pipeline_diag::pipeline_diag(
        "INGEST",
        "ingest_from_reel_multipart",
        "upload.rs",
        None,
        None,
        "enter",
    );
    let form = match media_api::parse_reel_multipart(payload).await {
        Ok(f) => f,
        Err(resp) => {
            crate::pipeline_diag::pipeline_diag(
                "INGEST",
                "ingest_from_reel_multipart",
                "upload.rs",
                None,
                None,
                "parse_multipart_error",
            );
            crate::pipeline_diag::pipeline_diag(
                "RESPONSE",
                "ingest_from_reel_multipart",
                "upload.rs",
                None,
                None,
                "bad_request",
            );
            return resp;
        }
    };

    if form.video.is_none() && form.thumbnail.is_none() {
        crate::pipeline_diag::pipeline_diag(
            "RESPONSE",
            "ingest_from_reel_multipart",
            "upload.rs",
            None,
            None,
            "400_no_media",
        );
        return HttpResponse::BadRequest().json(serde_json::json!({
            "error": "At least one of video or thumbnail is required"
        }));
    }

    if let Some((ref filename, ref bytes)) = form.video {
        crate::pipeline_diag::pipeline_diag(
            "INGEST",
            "ingest_from_reel_multipart",
            "upload.rs",
            None,
            Some(filename.as_str()),
            "route_video_bytes",
        );
        return ingest_video_bytes(
            svc,
            bytes,
            filename,
            form.title,
            form.description,
            form.category,
            form.thumbnail,
        )
        .await;
    }

    // Image-only upload (no async pipeline)
    if let Some((ref filename, ref bytes)) = form.thumbnail {
        crate::pipeline_diag::pipeline_diag(
            "INGEST",
            "ingest_from_reel_multipart",
            "upload.rs",
            None,
            Some(filename.as_str()),
            "route_image_only",
        );
        return ingest_image_only(svc, filename, bytes, form.title, form.category).await;
    }

    crate::pipeline_diag::pipeline_diag(
        "RESPONSE",
        "ingest_from_reel_multipart",
        "upload.rs",
        None,
        None,
        "400_no_valid_media",
    );
    HttpResponse::BadRequest().json(serde_json::json!({ "error": "No valid media in request" }))
}

async fn ingest_image_only(
    svc: &IngestionService,
    filename: &str,
    bytes: &[u8],
    title: Option<String>,
    category: Option<String>,
) -> HttpResponse {
    if let Err(reason) = media_api::validate_bytes_for_image(bytes, filename) {
        return HttpResponse::BadRequest().json(serde_json::json!({ "error": reason }));
    }

    let asset_id = Uuid::new_v4();
    crate::pipeline_diag::pipeline_diag(
        "INGEST",
        "ingest_image_only",
        "upload.rs",
        Some(&asset_id.to_string()),
        Some(filename),
        "asset_created",
    );
    let lowered = filename.to_lowercase();
    let (ext, mime) = if lowered.ends_with(".png") {
        (".png", "image/png")
    } else if lowered.ends_with(".webp") {
        (".webp", "image/webp")
    } else if lowered.ends_with(".gif") {
        (".gif", "image/gif")
    } else if lowered.ends_with(".jpeg") {
        (".jpeg", "image/jpeg")
    } else {
        (".jpg", "image/jpeg")
    };
    let stored_name = format!("{}{}", asset_id, ext);
    let thumb_path = svc.config.thumbs_path.join(&stored_name);
    if let Err(e) = std::fs::write(&thumb_path, bytes) {
        return HttpResponse::InternalServerError().json(serde_json::json!({
            "error": format!("Write failed: {}", e)
        }));
    }
    eprintln!(
        "[STORE_WRITE] kind=image path={} bytes={}",
        thumb_path.display(),
        bytes.len()
    );

    let thumb_url = format!("/thumbs/{}", stored_name);
    let title = title
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| reel_contract::display_name_from_filename(&stored_name));
    let category = category
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| "Trending".to_string());

    if let Err(e) = reels::insert_pending_reel(
        &svc.pool,
        asset_id,
        &title,
        &category,
        None,
        &thumb_url,
        Some(&thumb_url),
        &stored_name,
        bytes.len() as i64,
        Some(mime),
    )
    .await
    {
        return HttpResponse::InternalServerError().json(serde_json::json!({
            "error": e.to_string()
        }));
    }

    if let Err(e) = reels::mark_ready(&svc.pool, asset_id, &thumb_url).await {
        crate::pipeline_diag::pipeline_diag(
            "DB",
            "ingest_image_only",
            "upload.rs",
            Some(&asset_id.to_string()),
            Some(&stored_name),
            "mark_ready_failed",
        );
        return HttpResponse::InternalServerError().json(serde_json::json!({
            "error": e.to_string()
        }));
    }
    crate::pipeline_diag::pipeline_diag(
        "DB",
        "ingest_image_only",
        "upload.rs",
        Some(&asset_id.to_string()),
        Some(&stored_name),
        "mark_ready_ok",
    );
    eprintln!("[STORE_UPDATE] reel={} status=ready image_only=true", asset_id);

    reel_contract::publish_reel_ready(&svc.pool, asset_id, svc.event_bus.as_ref()).await;

    crate::pipeline_diag::pipeline_diag(
        "RESPONSE",
        "ingest_image_only",
        "upload.rs",
        Some(&asset_id.to_string()),
        Some(&stored_name),
        "ready",
    );

    HttpResponse::Accepted().json(IngestAcceptedResponse {
        id: asset_id.to_string(),
        status: "ready",
        video_url: db::canonical_media_url(&thumb_url),
        thumbnail_url: Some(db::canonical_media_url(&thumb_url)),
        poll_url: format!("/api/reels/{}", asset_id),
    })
}

pub async fn ingest_from_media_upload(
    svc: &IngestionService,
    field_name: &str,
    filename: &str,
    bytes: &[u8],
) -> HttpResponse {
    let is_image = field_name == "image"
        || field_name == "thumbnail"
        || media_api::is_image_filename(filename);

    if is_image {
        return ingest_image_only(svc, filename, bytes, None, None).await;
    }

    ingest_video_bytes(svc, bytes, filename, None, None, None, None).await
}
