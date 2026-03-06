use actix_web::{web, HttpResponse, Responder};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use uuid::Uuid;
use actix_files::NamedFile;
use actix_web::{HttpRequest, Result};
use urlencoding::decode;
use std::path::PathBuf;
use std::fs;
use crate::utils;

#[derive(Deserialize)]
pub struct ImportRequest {
    pub video_url: String,
}

#[derive(Serialize, Deserialize)]
pub struct LocalVideo {
    pub name: String,
    pub path: String,
    pub thumbnail_url: String,
}

#[derive(Serialize, sqlx::FromRow)]
pub struct Reel {
    pub id: Uuid,
    pub title: String,
    pub video_url: String,
    pub category: String,
}

// --- GET REELS ---
pub async fn get_reels(pool: web::Data<PgPool>) -> impl Responder {
    let result = sqlx::query_as!(
        Reel,
        "SELECT id, title as \"title!\", video_url as \"video_url!\", category as \"category!\" FROM reels ORDER BY id DESC"
    )
    .fetch_all(pool.get_ref())
    .await;

    match result {
        Ok(reels) => HttpResponse::Ok().json(reels),
        Err(e) => {
            println!("❌ DB Fetch Error: {}", e);
            HttpResponse::InternalServerError().finish()
        }
    }
}

// --- LIST LOCAL VIDEOS (relative path) ---
pub async fn list_local_videos() -> impl Responder {
    let videos_dir = "./public/videos";
    let entries = match fs::read_dir(videos_dir) {
        Ok(entries) => entries,
        Err(e) => {
            eprintln!("Failed to read videos dir: {}", e);
            return HttpResponse::InternalServerError().json(serde_json::json!({ "error": "cannot read directory" }));
        }
    };

    let mut videos = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
            if ext.eq_ignore_ascii_case("mp4") || ext.eq_ignore_ascii_case("mov") {
                if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                    videos.push(LocalVideo {
                        name: name.to_string(),
                        path: format!("/videos/{}", name),
                        thumbnail_url: "/placeholder-thumb.jpg".to_string(),
                    });
                }
            }
        }
    }

    HttpResponse::Ok().json(videos)
}

// --- IMPORT HANDLER with entry log and all required columns ---
pub async fn import_local_to_vault(
    req: web::Json<LocalVideo>,
    pool: web::Data<PgPool>,
) -> impl Responder {
    println!("🔥 import_local_to_vault HANDLER REACHED");
    let filename = req.name.clone();
    println!("🚀 Unveiling starting for: {}", filename);

    let local_path = format!("./public/videos/{}", filename);

    if !std::path::Path::new(&local_path).exists() {
        let err_msg = format!("File not found: {}", local_path);
        println!("❌ {}", err_msg);
        return HttpResponse::InternalServerError().body(err_msg);
    }

    println!("📤 Attempting to upload to Supabase: {}", filename);

    match crate::utils::upload_to_supabase(&local_path, &filename).await {
        Ok(cloud_url) => {
            println!("✅ Supabase upload succeeded: {}", cloud_url);
            let id = Uuid::new_v4();
            let thumbnail_placeholder = "/placeholder-thumb.jpg";
            let db_result = sqlx::query!(
                "INSERT INTO reels (id, title, video_url, category, episode, thumbnail_url) VALUES ($1, $2, $3, $4, $5, $6)",
                id, filename, cloud_url, "Uncategorized", 0, thumbnail_placeholder
            )
            .execute(pool.get_ref())
            .await;

            match db_result {
                Ok(_) => {
                    println!("✅ DB insert succeeded for {}", filename);
                    HttpResponse::Ok().json(serde_json::json!({ "status": "success", "url": cloud_url }))
                },
                Err(e) => {
                    println!("❌ DB insert error: {}", e);
                    HttpResponse::InternalServerError().body(format!("DB error: {}", e))
                }
            }
        },
        Err(e) => {
            println!("❌ Supabase upload failed: {}", e);
            HttpResponse::InternalServerError().body(format!("Upload failed: {}", e))
        }
    }
}

// --- DELETE REEL ---
pub async fn delete_reel(
    path: web::Path<Uuid>,
    pool: web::Data<PgPool>,
) -> impl Responder {
    let reel_id = path.into_inner();
    println!("🗑️ Delete request for reel ID: {}", reel_id);

    // Fetch the reel to get video_url (to extract filename)
    let reel = match sqlx::query!("SELECT video_url FROM reels WHERE id = $1", reel_id)
        .fetch_one(pool.get_ref())
        .await
    {
        Ok(r) => r,
        Err(e) => {
            println!("❌ Reel not found or DB error: {}", e);
            return HttpResponse::NotFound().body("Reel not found");
        }
    };

    // Extract filename from video_url (Supabase public URL)
    let video_url = reel.video_url;
    let filename = video_url
        .split('/')
        .last()
        .unwrap_or("")
        .to_string();

    if filename.is_empty() {
        println!("❌ Could not extract filename from URL: {}", video_url);
        return HttpResponse::InternalServerError().body("Invalid video URL");
    }

    println!("📎 Extracted filename: {}", filename);

    // Delete from Supabase storage
    match utils::delete_from_supabase(&filename).await {
        Ok(_) => println!("✅ Supabase deletion successful"),
        Err(e) => {
            println!("❌ Supabase deletion failed: {}", e);
            // Continue to delete DB record even if storage delete fails
        }
    }

    // Delete from database
    match sqlx::query!("DELETE FROM reels WHERE id = $1", reel_id)
        .execute(pool.get_ref())
        .await
    {
        Ok(_) => {
            println!("✅ DB deletion successful for reel ID: {}", reel_id);
            HttpResponse::Ok().json(serde_json::json!({ "status": "deleted" }))
        }
        Err(e) => {
            println!("❌ DB deletion error: {}", e);
            HttpResponse::InternalServerError().body(format!("DB error: {}", e))
        }
    }
}

// --- STUBS (keep others) ---
pub async fn register_local_video() -> impl Responder { HttpResponse::Ok().finish() }
pub async fn upload_video() -> impl Responder { HttpResponse::Ok().finish() }
pub async fn list_thumbnails() -> impl Responder { HttpResponse::Ok().finish() }
pub async fn sync_stats() -> impl Responder { HttpResponse::Ok().finish() }
pub async fn update_reel_category() -> impl Responder { HttpResponse::Ok().finish() }
pub async fn get_category_stats() -> impl Responder { HttpResponse::Ok().finish() }

// ===== FILE SERVING HANDLERS =====
pub async fn serve_video(
    req: HttpRequest,
    base_dir: web::Data<PathBuf>,
) -> Result<NamedFile> {
    serve_file(req, base_dir).await
}

pub async fn serve_thumb(
    req: HttpRequest,
    base_dir: web::Data<PathBuf>,
) -> Result<NamedFile> {
    serve_file(req, base_dir).await
}

async fn serve_file(
    req: HttpRequest,
    base_dir: web::Data<PathBuf>,
) -> Result<NamedFile> {
    let filename: String = req.match_info().query("filename").parse()
        .map_err(|_| actix_web::error::ErrorBadRequest("Invalid filename"))?;

    let decoded = decode(&filename)
        .map_err(|_| actix_web::error::ErrorBadRequest("Invalid encoding"))?
        .into_owned();

    let path = base_dir.join(decoded);

    if !path.starts_with(base_dir.as_ref()) {
        return Err(actix_web::error::ErrorForbidden("Access denied"));
    }

    Ok(NamedFile::open(path)?)
}
