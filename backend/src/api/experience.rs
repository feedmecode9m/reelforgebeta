use actix_web::{web, HttpResponse};
use sqlx::PgPool;
use uuid::Uuid;

use crate::db;
use crate::experience::experience_resolve::{resolve, ResolveError};

fn experience_disabled() -> HttpResponse {
    HttpResponse::NotFound().json(serde_json::json!({
        "error": "Experience resolve API disabled",
        "hint": "Set REELFORGE_EXPERIENCE_PROFILES=true to enable"
    }))
}

fn check_experience_enabled() -> Result<(), HttpResponse> {
    if db::experience_profiles_enabled() {
        Ok(())
    } else {
        Err(experience_disabled())
    }
}

#[derive(Debug, serde::Deserialize)]
pub struct ResolveQuery {
    pub episode_id: String,
}

pub async fn get_experience_resolve(
    pool: web::Data<PgPool>,
    query: web::Query<ResolveQuery>,
) -> HttpResponse {
    if let Err(resp) = check_experience_enabled() {
        return resp;
    }

    let episode_id = match Uuid::parse_str(query.episode_id.trim()) {
        Ok(id) => id,
        Err(_) => {
            return HttpResponse::BadRequest().json(serde_json::json!({
                "error": "Invalid episode_id",
                "hint": "Provide a valid UUID"
            }));
        }
    };

    match resolve(pool.get_ref(), episode_id).await {
        Ok(rve) => HttpResponse::Ok().json(rve),
        Err(ResolveError::NotFound) => HttpResponse::NotFound().json(serde_json::json!({
            "error": "Episode not found",
            "episode_id": episode_id
        })),
        Err(ResolveError::PinnedDraft) => HttpResponse::UnprocessableEntity().json(serde_json::json!({
            "error": "Pinned profile version cannot be DRAFT",
            "codes": ["NC-103"],
            "fields": ["experience_profile.profile_version_id"]
        })),
        Err(ResolveError::Validation { codes, fields }) => {
            HttpResponse::UnprocessableEntity().json(serde_json::json!({
                "error": "ResolvedViewerExperience validation failed",
                "codes": codes,
                "fields": fields
            }))
        }
        Err(ResolveError::Database(e)) => {
            HttpResponse::InternalServerError().json(serde_json::json!({
                "error": "Database error",
                "detail": e.to_string()
            }))
        }
    }
}
