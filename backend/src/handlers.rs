use actix_web::{get, post, delete, web, HttpResponse, Responder};
use sqlx::PgPool;
use uuid::Uuid;
use crate::db;
use crate::models::{
    Reel, StatsPayload, CreateReelRequest, Category, StudioStats, 
    ReelQuery, CategoryDetectionQuery, UpdateReelRequest
};
use crate::ai_detector::SmartCategoryDetector;
use serde_json::json;
use chrono::Utc;
use rand::seq::IndexedRandom; 
use std::process::Command;
use serde::{Deserialize, Serialize};

#[derive(Deserialize, Serialize)]
pub struct RenameRequest {
    pub old_name: String,
    pub new_name: String,
}

// --- ART VAULT ---
const STOIC_ART_VAULT: &[&str] = &[
    "/public/art/forgotten_mask.jpg",
    "/public/art/terra_cotta_warrior.jpg",
    "/public/art/bronze_monolith.jpg",
    "/public/art/charcoal_proverbs.jpg",
    "/public/art/stoic_sculpture.jpg"
];

pub fn extract_thumbnail(video_path: &str, output_path: &str) -> bool {
    let status = Command::new("ffmpeg")
        .args(["-y", "-i", video_path, "-ss", "00:00:01", "-vframes", "1", output_path])
        .status();
    match status {
        Ok(s) => s.success(),
        Err(_) => false,
    }
}

// 1. GET REELS
#[get("/reels")]
pub async fn get_reels(pool: web::Data<PgPool>, query: web::Query<ReelQuery>) -> impl Responder {
    let limit = query.limit.unwrap_or(100);
    let offset = query.offset.unwrap_or(0);

    // Clean SELECT * because the DB type now matches the Rust type
    let reels_result = sqlx::query_as::<_, Reel>("SELECT * FROM reels ORDER BY created_at DESC LIMIT $1 OFFSET $2")
        .bind(limit).bind(offset).fetch_all(pool.get_ref()).await;

    match reels_result {
        Ok(reels) => HttpResponse::Ok().json(reels),
        Err(e) => {
            eprintln!("❌ DATABASE DECODE ERROR: {:?}", e);
            HttpResponse::InternalServerError().json(json!({"error": e.to_string()}))
        }
    }
}

// 2. CREATE REEL
#[post("/reels")]
pub async fn create_reel(pool: web::Data<PgPool>, payload: web::Json<CreateReelRequest>) -> impl Responder {
    let mut req = payload.into_inner();
    let detection = SmartCategoryDetector::detect_from_title(&req.title);
    if req.category == "Auto-Detect" || req.category.is_empty() {
        req.category = detection.category.clone();
    }
    let video_url = req.video_url.unwrap_or_default();
    
    let mut rng = rand::rng(); 
    let final_thumbnail = req.thumbnail_url.filter(|s| !s.is_empty())
        .unwrap_or_else(|| STOIC_ART_VAULT.choose(&mut rng).unwrap_or(&"/public/art/default.jpg").to_string());

    let insert_result = sqlx::query_as::<_, Reel>(
        r#"INSERT INTO reels (id, title, category, episode, video_url, thumbnail_url, likes, created_at, updated_at) 
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *"#
    )
    .bind(Uuid::new_v4()).bind(&req.title).bind(&req.category).bind(req.episode.unwrap_or(0))
    .bind(video_url).bind(final_thumbnail).bind(0).bind(Utc::now()).bind(Utc::now())
    .fetch_one(pool.get_ref()).await;

    match insert_result {
        Ok(reel) => HttpResponse::Ok().json(reel),
        Err(e) => {
            eprintln!("❌ DATABASE DECODE ERROR (create_reel): {:?}", e);
            HttpResponse::InternalServerError().json(json!({"error": e.to_string()}))
        }
    }
}

// 3. SYNC STATS
#[post("/sync")]
pub async fn sync_stats(pool: web::Data<PgPool>, payload: web::Json<StatsPayload>) -> impl Responder {
    match db::sync_user_stats(pool.get_ref(), payload.user_id.clone().unwrap_or_default(), payload.points.unwrap_or(0), payload.total_reels).await {
        Ok(_) => HttpResponse::Ok().json(json!({"status": "synced"})),
        Err(e) => {
            eprintln!("❌ SYNC ERROR: {:?}", e);
            HttpResponse::InternalServerError().finish()
        }
    }
}

// 4. LIKE REEL
#[post("/reels/{id}/like")]
pub async fn like_reel(pool: web::Data<PgPool>, path: web::Path<Uuid>) -> impl Responder {
    let id = path.into_inner();
    match sqlx::query_as::<_, Reel>("UPDATE reels SET likes = likes + 1 WHERE id = $1 RETURNING *")
        .bind(id).fetch_one(pool.get_ref()).await {
        Ok(reel) => HttpResponse::Ok().json(reel),
        Err(e) => {
            eprintln!("❌ LIKE ERROR: {:?}", e);
            HttpResponse::NotFound().finish()
        }
    }
}

// 5. STUDIO DASHBOARD
#[get("/studio/dashboard")]
pub async fn get_studio_dashboard(pool: web::Data<PgPool>) -> impl Responder {
    let stats = sqlx::query_as::<_, StudioStats>("SELECT * FROM studio_stats WHERE id = 1")
        .fetch_optional(pool.get_ref()).await.unwrap_or(None);
    
    let categories = sqlx::query_as::<_, Category>("SELECT * FROM categories ORDER BY item_count DESC")
        .fetch_all(pool.get_ref()).await.unwrap_or_default();
    
    // Since you ran ALTER TABLE, SELECT * works perfectly now!
    let recent = sqlx::query_as::<_, Reel>("SELECT * FROM reels ORDER BY created_at DESC LIMIT 5")
        .fetch_all(pool.get_ref()).await.unwrap_or_default();

    HttpResponse::Ok().json(json!({ 
        "stats": stats, 
        "categories": categories, 
        "recentProductions": recent 
    }))
}

// 6. GET CATEGORIES
#[get("/studio/categories")]
pub async fn get_categories(pool: web::Data<PgPool>) -> impl Responder {
    match sqlx::query_as::<_, Category>("SELECT * FROM categories ORDER BY name").fetch_all(pool.get_ref()).await {
        Ok(c) => HttpResponse::Ok().json(c),
        Err(e) => {
            eprintln!("❌ CATEGORY FETCH ERROR: {:?}", e);
            HttpResponse::InternalServerError().finish()
        }
    }
}

// 7. AI DETECTION
#[get("/studio/detect")]
pub async fn detect_category(query: web::Query<CategoryDetectionQuery>) -> impl Responder {
    let title = query.title.clone().unwrap_or_default();
    let detection = SmartCategoryDetector::detect_from_title(&title);
    HttpResponse::Ok().json(json!({ "success": true, "detection": detection }))
}

// 8. DELETE REEL
#[delete("/studio/reels/{id}")]
pub async fn delete_reel(pool: web::Data<PgPool>, path: web::Path<Uuid>) -> impl Responder {
    let reel_id = path.into_inner();
    let reel = sqlx::query_as::<_, Reel>("SELECT * FROM reels WHERE id = $1")
        .bind(reel_id)
        .fetch_optional(pool.get_ref())
        .await;

    if let Ok(Some(reel_data)) = reel {
        if !reel_data.video_url.is_empty() {
            let _ = std::fs::remove_file(reel_data.video_url.trim_start_matches('/'));
        }

        let mut tx = match pool.begin().await {
            Ok(t) => t,
            Err(_) => return HttpResponse::InternalServerError().json(json!({"error": "Tx Fail"})),
        };

        let delete_op = sqlx::query("DELETE FROM reels WHERE id = $1")
            .bind(reel_id)
            .execute(&mut *tx)
            .await;

        let _ = sqlx::query("UPDATE categories SET item_count = GREATEST(0, item_count - 1) WHERE name = $1")
            .bind(&reel_data.category)
            .execute(&mut *tx)
            .await;

        if delete_op.is_ok() && tx.commit().await.is_ok() {
            println!("🤖 JANITOR AGENT: Production {} purged permanently.", reel_id);
            return HttpResponse::Ok().json(json!({"success": true, "status": "Permanently Destroyed"}));
        }
    }
    HttpResponse::NotFound().json(json!({"error": "Reel not found or already purged"}))
}

// 9. UPDATE REEL
#[post("/studio/reels/{id}/update")]
pub async fn update_reel(pool: web::Data<PgPool>, path: web::Path<Uuid>, req: web::Json<UpdateReelRequest>) -> impl Responder {
    let id = path.into_inner();
    let sql = match req.action.as_str() {
        "like" => "UPDATE reels SET likes = likes + 1 WHERE id = $1 RETURNING *",
        "view" => "UPDATE reels SET views = views + 1 WHERE id = $1 RETURNING *",
        _ => return HttpResponse::BadRequest().finish(),
    };
    match sqlx::query_as::<_, Reel>(sql).bind(id).fetch_one(pool.get_ref()).await {
        Ok(reel) => HttpResponse::Ok().json(reel),
        Err(e) => {
            eprintln!("❌ UPDATE DECODE ERROR: {:?}", e);
            HttpResponse::InternalServerError().finish()
        }
    }
}

// 10. RENAME CATEGORY
#[post("/studio/categories/rename")]
pub async fn rename_category(pool: web::Data<PgPool>, req: web::Json<RenameRequest>) -> impl Responder {
    let mut tx = pool.begin().await.unwrap();
    let _ = sqlx::query("UPDATE categories SET name = $1 WHERE name = $2")
        .bind(&req.new_name).bind(&req.old_name).execute(&mut *tx).await;
    let _ = sqlx::query("UPDATE reels SET category = $1 WHERE category = $2")
        .bind(&req.new_name).bind(&req.old_name).execute(&mut *tx).await;

    if tx.commit().await.is_ok() {
        HttpResponse::Ok().json(json!({"success": true}))
    } else {
        HttpResponse::InternalServerError().finish()
    }
}
