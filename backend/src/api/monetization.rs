use actix_web::{web, HttpResponse};
use sqlx::PgPool;
use uuid::Uuid;

use crate::db;
use crate::db::monetization::{
    UpdateEpisodeMonetization, UpdateProjectMonetization, UpdateSeasonMonetization,
    UpdateSeriesMonetization,
};

fn monetization_disabled() -> HttpResponse {
    HttpResponse::NotFound().json(serde_json::json!({
        "error": "Monetization API disabled",
        "hint": "Set REELFORGE_MONETIZATION=true to enable"
    }))
}

fn check_monetization_enabled() -> Result<(), HttpResponse> {
    if db::monetization_enabled() {
        Ok(())
    } else {
        Err(monetization_disabled())
    }
}

fn bad_id() -> HttpResponse {
    HttpResponse::BadRequest().json(serde_json::json!({ "error": "Invalid id" }))
}

fn map_update_error(msg: &str) -> HttpResponse {
    if msg.contains("not found") {
        HttpResponse::NotFound().json(serde_json::json!({ "error": msg }))
    } else {
        HttpResponse::BadRequest().json(serde_json::json!({ "error": msg }))
    }
}

#[derive(Debug, serde::Deserialize)]
pub struct ConfigQuery {
    pub project_id: Option<String>,
}

pub async fn monetization_status(_pool: web::Data<PgPool>) -> HttpResponse {
    if let Err(resp) = check_monetization_enabled() {
        return resp;
    }
    HttpResponse::Ok().json(serde_json::json!({
        "enabled": true,
        "enforce_paywall": false,
        "access_modes": db::monetization::ACCESS_MODES
    }))
}

pub async fn get_config(pool: web::Data<PgPool>, query: web::Query<ConfigQuery>) -> HttpResponse {
    if let Err(resp) = check_monetization_enabled() {
        return resp;
    }

    let project_id = match resolve_project_id(pool.get_ref(), query.project_id.as_deref()).await {
        Ok(id) => id,
        Err(resp) => return resp,
    };

    match db::monetization::get_monetization_config(pool.get_ref(), project_id).await {
        Ok(Some(config)) => HttpResponse::Ok().json(config),
        Ok(None) => HttpResponse::NotFound().json(serde_json::json!({
            "error": "Project not found"
        })),
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({
            "error": e.to_string()
        })),
    }
}

pub async fn get_project(pool: web::Data<PgPool>, path: web::Path<String>) -> HttpResponse {
    if let Err(resp) = check_monetization_enabled() {
        return resp;
    }
    let id = match Uuid::parse_str(&path.into_inner()) {
        Ok(u) => u,
        Err(_) => return bad_id(),
    };
    match db::monetization::get_project_monetization(pool.get_ref(), id).await {
        Ok(Some(row)) => HttpResponse::Ok().json(row),
        Ok(None) => {
            HttpResponse::NotFound().json(serde_json::json!({ "error": "Project not found" }))
        }
        Err(e) => {
            HttpResponse::InternalServerError().json(serde_json::json!({ "error": e.to_string() }))
        }
    }
}

pub async fn update_project(
    pool: web::Data<PgPool>,
    path: web::Path<String>,
    body: web::Json<UpdateProjectMonetization>,
) -> HttpResponse {
    if let Err(resp) = check_monetization_enabled() {
        return resp;
    }
    let id = match Uuid::parse_str(&path.into_inner()) {
        Ok(u) => u,
        Err(_) => return bad_id(),
    };
    match db::monetization::update_project_monetization(pool.get_ref(), id, &*body).await {
        Ok(Ok(row)) => HttpResponse::Ok().json(row),
        Ok(Err(msg)) => map_update_error(msg),
        Err(e) => {
            HttpResponse::InternalServerError().json(serde_json::json!({ "error": e.to_string() }))
        }
    }
}

pub async fn get_series(pool: web::Data<PgPool>, path: web::Path<String>) -> HttpResponse {
    if let Err(resp) = check_monetization_enabled() {
        return resp;
    }
    let id = match Uuid::parse_str(&path.into_inner()) {
        Ok(u) => u,
        Err(_) => return bad_id(),
    };
    match db::monetization::get_series_monetization(pool.get_ref(), id).await {
        Ok(Some(row)) => HttpResponse::Ok().json(row),
        Ok(None) => {
            HttpResponse::NotFound().json(serde_json::json!({ "error": "Series not found" }))
        }
        Err(e) => {
            HttpResponse::InternalServerError().json(serde_json::json!({ "error": e.to_string() }))
        }
    }
}

pub async fn update_series(
    pool: web::Data<PgPool>,
    path: web::Path<String>,
    body: web::Json<UpdateSeriesMonetization>,
) -> HttpResponse {
    if let Err(resp) = check_monetization_enabled() {
        return resp;
    }
    let id = match Uuid::parse_str(&path.into_inner()) {
        Ok(u) => u,
        Err(_) => return bad_id(),
    };
    match db::monetization::update_series_monetization(pool.get_ref(), id, &*body).await {
        Ok(Ok(row)) => HttpResponse::Ok().json(row),
        Ok(Err(msg)) => map_update_error(msg),
        Err(e) => {
            HttpResponse::InternalServerError().json(serde_json::json!({ "error": e.to_string() }))
        }
    }
}

pub async fn get_season(pool: web::Data<PgPool>, path: web::Path<String>) -> HttpResponse {
    if let Err(resp) = check_monetization_enabled() {
        return resp;
    }
    let id = match Uuid::parse_str(&path.into_inner()) {
        Ok(u) => u,
        Err(_) => return bad_id(),
    };
    match db::monetization::get_season_monetization(pool.get_ref(), id).await {
        Ok(Some(row)) => HttpResponse::Ok().json(row),
        Ok(None) => {
            HttpResponse::NotFound().json(serde_json::json!({ "error": "Season not found" }))
        }
        Err(e) => {
            HttpResponse::InternalServerError().json(serde_json::json!({ "error": e.to_string() }))
        }
    }
}

pub async fn update_season(
    pool: web::Data<PgPool>,
    path: web::Path<String>,
    body: web::Json<UpdateSeasonMonetization>,
) -> HttpResponse {
    if let Err(resp) = check_monetization_enabled() {
        return resp;
    }
    let id = match Uuid::parse_str(&path.into_inner()) {
        Ok(u) => u,
        Err(_) => return bad_id(),
    };
    match db::monetization::update_season_monetization(pool.get_ref(), id, &*body).await {
        Ok(Ok(row)) => HttpResponse::Ok().json(row),
        Ok(Err(msg)) => map_update_error(msg),
        Err(e) => {
            HttpResponse::InternalServerError().json(serde_json::json!({ "error": e.to_string() }))
        }
    }
}

pub async fn get_episode(pool: web::Data<PgPool>, path: web::Path<String>) -> HttpResponse {
    if let Err(resp) = check_monetization_enabled() {
        return resp;
    }
    let id = match Uuid::parse_str(&path.into_inner()) {
        Ok(u) => u,
        Err(_) => return bad_id(),
    };
    match db::monetization::get_episode_monetization(pool.get_ref(), id).await {
        Ok(Some(row)) => HttpResponse::Ok().json(serde_json::json!({
            "episode": row,
            "access_granted": true
        })),
        Ok(None) => {
            HttpResponse::NotFound().json(serde_json::json!({ "error": "Episode not found" }))
        }
        Err(e) => {
            HttpResponse::InternalServerError().json(serde_json::json!({ "error": e.to_string() }))
        }
    }
}

pub async fn update_episode(
    pool: web::Data<PgPool>,
    path: web::Path<String>,
    body: web::Json<UpdateEpisodeMonetization>,
) -> HttpResponse {
    if let Err(resp) = check_monetization_enabled() {
        return resp;
    }
    let id = match Uuid::parse_str(&path.into_inner()) {
        Ok(u) => u,
        Err(_) => return bad_id(),
    };
    match db::monetization::update_episode_monetization(pool.get_ref(), id, &*body).await {
        Ok(Ok(row)) => HttpResponse::Ok().json(serde_json::json!({
            "episode": row,
            "access_granted": true
        })),
        Ok(Err(msg)) => map_update_error(msg),
        Err(e) => {
            HttpResponse::InternalServerError().json(serde_json::json!({ "error": e.to_string() }))
        }
    }
}

async fn resolve_project_id(pool: &PgPool, raw: Option<&str>) -> Result<Uuid, HttpResponse> {
    if let Some(id_str) = raw {
        return Uuid::parse_str(id_str).map_err(|_| bad_id());
    }

    let catalog = match sqlx::query_scalar::<_, Uuid>(
        "SELECT id FROM studio_projects WHERE slug = 'reelforge-catalog' LIMIT 1",
    )
    .fetch_optional(pool)
    .await
    {
        Ok(v) => v,
        Err(e) => {
            return Err(HttpResponse::InternalServerError().json(serde_json::json!({
                "error": e.to_string()
            })))
        }
    };

    catalog.ok_or_else(|| {
        HttpResponse::NotFound().json(serde_json::json!({
            "error": "No project_id provided and catalog project not found"
        }))
    })
}
