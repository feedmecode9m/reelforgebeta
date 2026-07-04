use actix_web::{web, HttpResponse};
use sqlx::PgPool;
use uuid::Uuid;

use crate::reel_contract::{self, ReelV1};

pub async fn list_ready_reels(pool: web::Data<PgPool>) -> HttpResponse {
    match crate::db::reels::list_ready_reels(pool.get_ref()).await {
        Ok(rows) => {
            let responses: Vec<ReelV1> = rows.iter().map(reel_contract::row_to_reel_v1).collect();
            eprintln!(
                "GET /api/reels returning {} ready items [postgres]",
                responses.len()
            );
            HttpResponse::Ok().json(responses)
        }
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({
            "error": e.to_string()
        })),
    }
}

pub async fn get_reel_by_id(pool: web::Data<PgPool>, path: web::Path<String>) -> HttpResponse {
    let id_str = path.into_inner();
    let id = match Uuid::parse_str(&id_str) {
        Ok(u) => u,
        Err(_) => {
            return HttpResponse::BadRequest().json(serde_json::json!({
                "error": "Invalid reel id"
            }));
        }
    };

    match crate::db::reels::get_reel_by_id(pool.get_ref(), id).await {
        Ok(Some(row)) => HttpResponse::Ok().json(reel_contract::row_to_status_response(&row)),
        Ok(None) => HttpResponse::NotFound().json(serde_json::json!({
            "error": "Reel not found"
        })),
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({
            "error": e.to_string()
        })),
    }
}
