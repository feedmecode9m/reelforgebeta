use actix_files::NamedFile;
use actix_web::http::header;
use actix_web::{web, HttpRequest, HttpResponse};
use std::path::{Path, PathBuf};

const MIME_DEBUG: bool = false;

#[derive(Clone)]
pub struct VideosDir(pub PathBuf);
#[derive(Clone)]
pub struct ThumbsDir(pub PathBuf);

pub fn mime_for_path(path: &Path) -> &'static str {
    let mime = match path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_lowercase())
        .as_deref()
    {
        Some("mp4") => "video/mp4",
        Some("mov") => "video/quicktime",
        Some("webm") => "video/webm",
        Some("m4v") => "video/mp4",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("png") => "image/png",
        Some("webp") => "image/webp",
        Some("gif") => "image/gif",
        _ => "application/octet-stream",
    };

    if MIME_DEBUG {
        eprintln!(
            "[mime] {:?} -> {}",
            path.file_name().unwrap_or_default(),
            mime
        );
    }

    mime
}

pub fn resolve_media_path(base: &Path, filename: &str) -> Option<PathBuf> {
    if filename.is_empty() || filename.contains("..") || filename.starts_with('/') {
        return None;
    }

    let base = base.canonicalize().unwrap_or_else(|_| base.to_path_buf());
    let mut resolved = base.clone();

    for component in Path::new(filename).components() {
        match component {
            std::path::Component::Normal(part) => resolved.push(part),
            std::path::Component::ParentDir => return None,
            _ => return None,
        }
    }

    if resolved.starts_with(&base) {
        Some(resolved)
    } else {
        None
    }
}

pub fn log_media_directory(label: &str, dir: &Path) {
    println!("📁 {} ({:?}):", label, dir);

    match std::fs::read_dir(dir) {
        Ok(entries) => {
            let mut files: Vec<_> = entries.filter_map(Result::ok).collect();
            files.sort_by_key(|entry| entry.file_name());

            if files.is_empty() {
                println!("   (empty — requests will return 404 JSON)");
                return;
            }

            for entry in files {
                let name = entry.file_name().to_string_lossy().to_string();
                let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
                let mime = mime_for_path(&entry.path());
                println!("   - {} ({} bytes, {})", name, size, mime);
            }
        }
        Err(error) => println!("   ⚠️ Cannot read directory: {}", error),
    }
}

pub fn verify_media_directories(videos: &Path, thumbs: &Path) {
    for (label, path) in [("public/videos", videos), ("public/thumbs", thumbs)] {
        if path.exists() && path.is_dir() {
            println!(
                "✅ {} verified at {:?}",
                label,
                path.canonicalize().unwrap_or_else(|_| path.to_path_buf())
            );
        } else if !path.exists() {
            eprintln!("❌ {} missing at {:?} — creating", label, path);
            let _ = std::fs::create_dir_all(path);
        } else {
            eprintln!("❌ {} exists but is not a directory: {:?}", label, path);
        }
    }

    let invalid = crate::media_validator::quarantine_invalid_loose_files(videos);
    if invalid > 0 {
        eprintln!(
            "⚠️ Quarantined {} invalid loose video(s) to public/videos/_rejected/",
            invalid
        );
    }
    for (name, reason) in crate::media_seed::scan_invalid_videos(videos) {
        eprintln!(
            "⚠️ Invalid video in public/videos/{} — {} (excluded from /api/videos)",
            name, reason
        );
    }
}

pub async fn serve_media_file(
    req: HttpRequest,
    file_path: PathBuf,
    not_found_label: &str,
) -> HttpResponse {
    if !file_path.is_file() {
        return HttpResponse::NotFound().json(serde_json::json!({
            "error": format!("{} not found", not_found_label),
            "path": file_path.display().to_string()
        }));
    }

    if not_found_label == "Video" && !crate::media_validator::passes_serve_time_gate(&file_path) {
        eprintln!(
            "rejecting file: reason=serve_time_gate_failed path={}",
            file_path.display()
        );
        return HttpResponse::UnprocessableEntity().json(serde_json::json!({
            "error": "Video file failed validation and cannot be served",
            "path": file_path.display().to_string()
        }));
    }

    match NamedFile::open_async(&file_path).await {
        Ok(file) => {
            let mime = mime_for_path(&file_path);
            let mut response = file
                .use_last_modified(true)
                .use_etag(true)
                .set_content_type(mime.parse().unwrap())
                .into_response(&req);
            // Binary media must not carry Content-Encoding (including identity on 206 Range).
            response.headers_mut().remove(header::CONTENT_ENCODING);
            response.headers_mut().insert(
                header::ACCEPT_RANGES,
                header::HeaderValue::from_static("bytes"),
            );
            response
        }
        Err(error) => HttpResponse::InternalServerError().json(serde_json::json!({
            "error": format!("Failed to open {}: {}", not_found_label, error)
        })),
    }
}

/// GET /thumbs/{filename} — same no-compression guarantees as videos.
pub async fn serve_thumb(
    req: HttpRequest,
    path: web::Path<String>,
    thumbs_path: web::Data<ThumbsDir>,
) -> HttpResponse {
    let filename = path.into_inner();
    let Some(file_path) = resolve_media_path(&thumbs_path.0, &filename) else {
        return HttpResponse::BadRequest().json(serde_json::json!({
            "error": "Invalid thumbnail path"
        }));
    };
    serve_media_file(req, file_path, "Thumbnail").await
}

/// GET /videos/{filename} — correct Content-Type for .mov (video/quicktime), etc.
pub async fn serve_video(
    req: HttpRequest,
    path: web::Path<String>,
    videos_path: web::Data<VideosDir>,
) -> HttpResponse {
    let filename = path.into_inner();
    if filename.contains("_rejected") || filename.starts_with('_') {
        return HttpResponse::Forbidden().json(serde_json::json!({
            "error": "Access to rejected/quarantined media is forbidden"
        }));
    }
    let Some(file_path) = resolve_media_path(&videos_path.0, &filename) else {
        return HttpResponse::BadRequest().json(serde_json::json!({
            "error": "Invalid video path"
        }));
    };
    serve_media_file(req, file_path, "Video").await
}
