use actix_web::{HttpResponse, web};
use chrono::Utc;
use serde_json::json;
use sqlx::PgPool;

use crate::db;
use crate::models::Reel;

pub async fn health(pool: web::Data<PgPool>) -> HttpResponse {
    let db_status = match sqlx::query("SELECT 1").execute(pool.get_ref()).await {
        Ok(_) => "connected",
        Err(_) => "disconnected",
    };

    HttpResponse::Ok().json(json!({
        "status": "ok",
        "timestamp": Utc::now().timestamp_millis(),
        "service": "reelforge-backend",
        "database": db_status,
        "reels_source": "postgres-ingestion-v2",
        "services": {
            "db": db_status,
            "storage": "ready",
            "ingestion": "enabled"
        }
    }))
}

pub async fn list_reels(pool: web::Data<PgPool>) -> HttpResponse {
    match db::list_reels(pool.get_ref()).await {
        Ok(reels) => HttpResponse::Ok().json(reels),
        Err(error) => HttpResponse::InternalServerError().json(json!({
            "error": error.to_string()
        })),
    }
}

pub async fn seed_reels(pool: web::Data<PgPool>) -> HttpResponse {
    match db::seed_placeholders(pool.get_ref()).await {
        Ok(reels) => HttpResponse::Ok().json(reels),
        Err(error) => HttpResponse::InternalServerError().json(json!({
            "error": error.to_string()
        })),
    }
}

pub async fn get_reel_by_id(pool: web::Data<PgPool>, path: web::Path<String>) -> HttpResponse {
    let reel_id = path.into_inner();
    if reel_id == "seed" {
        return seed_reels(pool).await;
    }

    let parsed = match uuid::Uuid::parse_str(&reel_id) {
        Ok(id) => id,
        Err(_) => {
            return HttpResponse::BadRequest().json(json!({
                "error": "Invalid reel id"
            }));
        }
    };

    match sqlx::query_as::<_, Reel>(
        r#"
        SELECT id, title, description, thumbnail_url, status, created_at
        FROM reels
        WHERE id = $1
        "#,
    )
    .bind(parsed)
    .fetch_optional(pool.get_ref())
    .await
    {
        Ok(Some(reel)) => HttpResponse::Ok().json(reel),
        Ok(None) => HttpResponse::NotFound().json(json!({ "error": "Reel not found" })),
        Err(error) => HttpResponse::InternalServerError().json(json!({
            "error": error.to_string()
        })),
    }
}
