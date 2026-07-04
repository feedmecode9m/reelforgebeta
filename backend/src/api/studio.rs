use actix_web::{web, HttpResponse};
use serde::Deserialize;
use sqlx::PgPool;
use uuid::Uuid;

use crate::db;

fn studio_disabled() -> HttpResponse {
    HttpResponse::NotFound().json(serde_json::json!({
        "error": "Studio hierarchy disabled",
        "hint": "Set REELFORGE_STUDIO_HIERARCHY=true to enable"
    }))
}

fn check_studio_enabled() -> Result<(), HttpResponse> {
    if db::studio_hierarchy_enabled() {
        Ok(())
    } else {
        Err(studio_disabled())
    }
}

pub async fn studio_status(pool: web::Data<PgPool>) -> HttpResponse {
    if let Err(resp) = check_studio_enabled() {
        return resp;
    }
    match db::studio::count_hierarchy(pool.get_ref()).await {
        Ok(counts) => HttpResponse::Ok().json(serde_json::json!({
            "enabled": true,
            "counts": counts
        })),
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({
            "error": e.to_string()
        })),
    }
}

pub async fn list_projects(pool: web::Data<PgPool>) -> HttpResponse {
    if let Err(resp) = check_studio_enabled() {
        return resp;
    }
    match db::studio::list_projects(pool.get_ref()).await {
        Ok(rows) => HttpResponse::Ok().json(rows),
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({
            "error": e.to_string()
        })),
    }
}

#[derive(Debug, Deserialize)]
pub struct CreateProjectBody {
    pub name: String,
    pub slug: Option<String>,
}

pub async fn create_project(
    pool: web::Data<PgPool>,
    body: web::Json<CreateProjectBody>,
) -> HttpResponse {
    if let Err(resp) = check_studio_enabled() {
        return resp;
    }
    let name = body.name.trim();
    if name.is_empty() {
        return HttpResponse::BadRequest().json(serde_json::json!({
            "error": "name is required"
        }));
    }
    match db::studio::create_project(pool.get_ref(), name, body.slug.as_deref()).await {
        Ok(row) => HttpResponse::Created().json(row),
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({
            "error": e.to_string()
        })),
    }
}

pub async fn get_project_tree(pool: web::Data<PgPool>, path: web::Path<String>) -> HttpResponse {
    if let Err(resp) = check_studio_enabled() {
        return resp;
    }
    let id = match Uuid::parse_str(&path.into_inner()) {
        Ok(u) => u,
        Err(_) => {
            return HttpResponse::BadRequest().json(serde_json::json!({
                "error": "Invalid project id"
            }));
        }
    };
    match db::studio::get_project_tree(pool.get_ref(), id).await {
        Ok(Some(tree)) => HttpResponse::Ok().json(tree),
        Ok(None) => HttpResponse::NotFound().json(serde_json::json!({
            "error": "Project not found"
        })),
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({
            "error": e.to_string()
        })),
    }
}

#[derive(Debug, Deserialize)]
pub struct ListSeriesQuery {
    pub project_id: Option<String>,
}

pub async fn list_series(
    pool: web::Data<PgPool>,
    query: web::Query<ListSeriesQuery>,
) -> HttpResponse {
    if let Err(resp) = check_studio_enabled() {
        return resp;
    }
    let project_id = if let Some(ref raw) = query.project_id {
        match Uuid::parse_str(raw) {
            Ok(u) => Some(u),
            Err(_) => {
                return HttpResponse::BadRequest().json(serde_json::json!({
                    "error": "Invalid project_id"
                }));
            }
        }
    } else {
        None
    };
    match db::studio::list_series(pool.get_ref(), project_id).await {
        Ok(rows) => HttpResponse::Ok().json(rows),
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({
            "error": e.to_string()
        })),
    }
}

#[derive(Debug, Deserialize)]
pub struct CreateSeriesBody {
    pub project_id: String,
    pub title: String,
    pub description: Option<String>,
}

pub async fn create_series(
    pool: web::Data<PgPool>,
    body: web::Json<CreateSeriesBody>,
) -> HttpResponse {
    if let Err(resp) = check_studio_enabled() {
        return resp;
    }
    let project_id = match Uuid::parse_str(&body.project_id) {
        Ok(u) => u,
        Err(_) => {
            return HttpResponse::BadRequest().json(serde_json::json!({
                "error": "Invalid project_id"
            }));
        }
    };
    let title = body.title.trim();
    if title.is_empty() {
        return HttpResponse::BadRequest().json(serde_json::json!({
            "error": "title is required"
        }));
    }
    match db::studio::create_series(
        pool.get_ref(),
        project_id,
        title,
        body.description.as_deref(),
    )
    .await
    {
        Ok(row) => HttpResponse::Created().json(row),
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({
            "error": e.to_string()
        })),
    }
}

#[derive(Debug, Deserialize)]
pub struct CreateSeasonBody {
    pub series_id: String,
    pub season_number: i32,
    pub title: Option<String>,
}

pub async fn create_season(
    pool: web::Data<PgPool>,
    body: web::Json<CreateSeasonBody>,
) -> HttpResponse {
    if let Err(resp) = check_studio_enabled() {
        return resp;
    }
    let series_id = match Uuid::parse_str(&body.series_id) {
        Ok(u) => u,
        Err(_) => {
            return HttpResponse::BadRequest().json(serde_json::json!({
                "error": "Invalid series_id"
            }));
        }
    };
    if body.season_number < 1 {
        return HttpResponse::BadRequest().json(serde_json::json!({
            "error": "season_number must be >= 1"
        }));
    }
    match db::studio::create_season(
        pool.get_ref(),
        series_id,
        body.season_number,
        body.title.as_deref(),
    )
    .await
    {
        Ok(row) => HttpResponse::Created().json(row),
        Err(e) => {
            if let sqlx::Error::Database(db_err) = &e {
                if db_err.constraint().is_some() {
                    return HttpResponse::Conflict().json(serde_json::json!({
                        "error": "Season number already exists for this series"
                    }));
                }
            }
            HttpResponse::InternalServerError().json(serde_json::json!({
                "error": e.to_string()
            }))
        }
    }
}

pub async fn list_episodes(pool: web::Data<PgPool>, path: web::Path<String>) -> HttpResponse {
    if let Err(resp) = check_studio_enabled() {
        return resp;
    }
    let season_id = match Uuid::parse_str(&path.into_inner()) {
        Ok(u) => u,
        Err(_) => {
            return HttpResponse::BadRequest().json(serde_json::json!({
                "error": "Invalid season id"
            }));
        }
    };
    match db::studio::list_episodes_for_season(pool.get_ref(), season_id).await {
        Ok(rows) => HttpResponse::Ok().json(rows),
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({
            "error": e.to_string()
        })),
    }
}

#[derive(Debug, Deserialize)]
pub struct CreateEpisodeBody {
    pub season_id: String,
    pub episode_number: i32,
    pub title: String,
    pub description: Option<String>,
    pub reel_id: Option<String>,
}

pub async fn create_episode(
    pool: web::Data<PgPool>,
    body: web::Json<CreateEpisodeBody>,
) -> HttpResponse {
    if let Err(resp) = check_studio_enabled() {
        return resp;
    }
    let season_id = match Uuid::parse_str(&body.season_id) {
        Ok(u) => u,
        Err(_) => {
            return HttpResponse::BadRequest().json(serde_json::json!({
                "error": "Invalid season_id"
            }));
        }
    };
    let reel_id = if let Some(ref raw) = body.reel_id {
        match Uuid::parse_str(raw) {
            Ok(u) => Some(u),
            Err(_) => {
                return HttpResponse::BadRequest().json(serde_json::json!({
                    "error": "Invalid reel_id"
                }));
            }
        }
    } else {
        None
    };
    let title = body.title.trim();
    if title.is_empty() {
        return HttpResponse::BadRequest().json(serde_json::json!({
            "error": "title is required"
        }));
    }
    if body.episode_number < 1 {
        return HttpResponse::BadRequest().json(serde_json::json!({
            "error": "episode_number must be >= 1"
        }));
    }
    match db::studio::create_episode(
        pool.get_ref(),
        season_id,
        body.episode_number,
        title,
        body.description.as_deref(),
        reel_id,
    )
    .await
    {
        Ok(row) => HttpResponse::Created().json(row),
        Err(e) => {
            if let sqlx::Error::Database(db_err) = &e {
                if db_err.constraint().is_some() {
                    return HttpResponse::Conflict().json(serde_json::json!({
                        "error": "Episode number or reel_id conflict"
                    }));
                }
            }
            HttpResponse::InternalServerError().json(serde_json::json!({
                "error": e.to_string()
            }))
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct AttachReelBody {
    pub reel_id: String,
}

pub async fn attach_reel(
    pool: web::Data<PgPool>,
    path: web::Path<String>,
    body: web::Json<AttachReelBody>,
) -> HttpResponse {
    if let Err(resp) = check_studio_enabled() {
        return resp;
    }
    let episode_id = match Uuid::parse_str(&path.into_inner()) {
        Ok(u) => u,
        Err(_) => {
            return HttpResponse::BadRequest().json(serde_json::json!({
                "error": "Invalid episode id"
            }));
        }
    };
    let reel_id = match Uuid::parse_str(&body.reel_id) {
        Ok(u) => u,
        Err(_) => {
            return HttpResponse::BadRequest().json(serde_json::json!({
                "error": "Invalid reel_id"
            }));
        }
    };
    match db::studio::attach_reel_to_episode(pool.get_ref(), episode_id, reel_id).await {
        Ok(db::studio::AttachReelOutcome::Attached(row)) => HttpResponse::Ok().json(row),
        Ok(db::studio::AttachReelOutcome::EpisodeNotFound) => {
            HttpResponse::NotFound().json(serde_json::json!({
                "error": "Episode not found"
            }))
        }
        Ok(db::studio::AttachReelOutcome::ReelNotFound) => {
            HttpResponse::NotFound().json(serde_json::json!({ "error": "Reel not found" }))
        }
        Ok(db::studio::AttachReelOutcome::ReelAlreadyBound) => HttpResponse::Conflict()
            .json(serde_json::json!({ "error": "Reel is already attached to another episode" })),
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({
            "error": e.to_string()
        })),
    }
}

pub async fn backfill_hierarchy(pool: web::Data<PgPool>) -> HttpResponse {
    if let Err(resp) = check_studio_enabled() {
        return resp;
    }
    match db::studio::backfill_reels_to_hierarchy(pool.get_ref()).await {
        Ok(report) => HttpResponse::Ok().json(report),
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({
            "error": e.to_string()
        })),
    }
}
