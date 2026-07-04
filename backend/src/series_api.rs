use actix_web::{web, HttpResponse};
use sqlx::PgPool;

use crate::db;
use crate::db::series::{
    CreateEpisodeInput, CreateSeasonInput, UpdateEpisodeInput, UpsertSeriesInput,
};

fn series_disabled() -> HttpResponse {
    HttpResponse::NotFound().json(serde_json::json!({
        "error": "Series API disabled",
        "hint": "Set REELFORGE_SERIES_API=true to enable"
    }))
}

fn check_series_enabled() -> Result<(), HttpResponse> {
    if db::series_api_enabled() {
        Ok(())
    } else {
        Err(series_disabled())
    }
}

pub async fn series_status(pool: web::Data<PgPool>) -> HttpResponse {
    if let Err(resp) = check_series_enabled() {
        return resp;
    }
    match db::series::count_series(pool.get_ref()).await {
        Ok(count) => HttpResponse::Ok().json(serde_json::json!({
            "enabled": true,
            "count": count
        })),
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({
            "error": e.to_string()
        })),
    }
}

pub async fn list_series(pool: web::Data<PgPool>) -> HttpResponse {
    if let Err(resp) = check_series_enabled() {
        return resp;
    }
    match db::series::list_series(pool.get_ref()).await {
        Ok(rows) => HttpResponse::Ok().json(rows),
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({
            "error": e.to_string()
        })),
    }
}

pub async fn get_series(pool: web::Data<PgPool>, path: web::Path<String>) -> HttpResponse {
    if let Err(resp) = check_series_enabled() {
        return resp;
    }
    let id = path.into_inner();
    if id.trim().is_empty() {
        return HttpResponse::BadRequest().json(serde_json::json!({
            "error": "Series id is required"
        }));
    }
    match db::series::get_series(pool.get_ref(), &id).await {
        Ok(Some(series)) => HttpResponse::Ok().json(series),
        Ok(None) => HttpResponse::NotFound().json(serde_json::json!({
            "error": "Series not found"
        })),
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({
            "error": e.to_string()
        })),
    }
}

pub async fn create_series(pool: web::Data<PgPool>, body: web::Json<UpsertSeriesInput>) -> HttpResponse {
    if let Err(resp) = check_series_enabled() {
        return resp;
    }
    let title = body.title.trim();
    if title.is_empty() {
        return HttpResponse::BadRequest().json(serde_json::json!({
            "error": "title is required"
        }));
    }
    match db::series::upsert_series(pool.get_ref(), &body).await {
        Ok(series) => HttpResponse::Created().json(series),
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({
            "error": e.to_string()
        })),
    }
}

pub async fn update_series(
    pool: web::Data<PgPool>,
    path: web::Path<String>,
    body: web::Json<UpsertSeriesInput>,
) -> HttpResponse {
    if let Err(resp) = check_series_enabled() {
        return resp;
    }
    let id = path.into_inner();
    if id.trim().is_empty() {
        return HttpResponse::BadRequest().json(serde_json::json!({
            "error": "Series id is required"
        }));
    }
    let title = body.title.trim();
    if title.is_empty() {
        return HttpResponse::BadRequest().json(serde_json::json!({
            "error": "title is required"
        }));
    }
    let mut input = body.into_inner();
    input.id = Some(id);
    match db::series::upsert_series(pool.get_ref(), &input).await {
        Ok(series) => HttpResponse::Ok().json(series),
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({
            "error": e.to_string()
        })),
    }
}

pub async fn list_series_seasons(pool: web::Data<PgPool>, path: web::Path<String>) -> HttpResponse {
    if let Err(resp) = check_series_enabled() {
        return resp;
    }
    let series_id = path.into_inner();
    match db::series::series_exists(pool.get_ref(), &series_id).await {
        Ok(false) => {
            return HttpResponse::NotFound().json(serde_json::json!({
                "error": "Series not found"
            }));
        }
        Err(e) => {
            return HttpResponse::InternalServerError().json(serde_json::json!({
                "error": e.to_string()
            }));
        }
        Ok(true) => {}
    }

    match db::series::list_seasons_for_series(pool.get_ref(), &series_id).await {
        Ok(seasons) => HttpResponse::Ok().json(seasons),
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({
            "error": e.to_string()
        })),
    }
}

pub async fn list_series_episodes(pool: web::Data<PgPool>, path: web::Path<String>) -> HttpResponse {
    if let Err(resp) = check_series_enabled() {
        return resp;
    }
    let series_id = path.into_inner();
    match db::series::series_exists(pool.get_ref(), &series_id).await {
        Ok(false) => {
            return HttpResponse::NotFound().json(serde_json::json!({
                "error": "Series not found"
            }));
        }
        Err(e) => {
            return HttpResponse::InternalServerError().json(serde_json::json!({
                "error": e.to_string()
            }));
        }
        Ok(true) => {}
    }

    match db::series::list_episodes_for_series(pool.get_ref(), &series_id).await {
        Ok(episodes) => HttpResponse::Ok().json(episodes),
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({
            "error": e.to_string()
        })),
    }
}

pub async fn create_series_season(
    pool: web::Data<PgPool>,
    path: web::Path<String>,
    body: web::Json<CreateSeasonInput>,
) -> HttpResponse {
    if let Err(resp) = check_series_enabled() {
        return resp;
    }
    let series_id = path.into_inner();
    match db::series::series_exists(pool.get_ref(), &series_id).await {
        Ok(false) => {
            return HttpResponse::NotFound().json(serde_json::json!({
                "error": "Series not found"
            }));
        }
        Err(e) => {
            return HttpResponse::InternalServerError().json(serde_json::json!({
                "error": e.to_string()
            }));
        }
        Ok(true) => {}
    }

    match db::series::create_season(pool.get_ref(), &series_id, &body).await {
        Ok(season) => HttpResponse::Created().json(season),
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({
            "error": e.to_string()
        })),
    }
}

pub async fn create_episode(pool: web::Data<PgPool>, body: web::Json<CreateEpisodeInput>) -> HttpResponse {
    if let Err(resp) = check_series_enabled() {
        return resp;
    }
    if body.series_id.trim().is_empty() {
        return HttpResponse::BadRequest().json(serde_json::json!({
            "error": "seriesId is required"
        }));
    }
    if body.title.trim().is_empty() {
        return HttpResponse::BadRequest().json(serde_json::json!({
            "error": "title is required"
        }));
    }

    match db::series::series_exists(pool.get_ref(), &body.series_id).await {
        Ok(false) => {
            return HttpResponse::NotFound().json(serde_json::json!({
                "error": "Series not found"
            }));
        }
        Err(e) => {
            return HttpResponse::InternalServerError().json(serde_json::json!({
                "error": e.to_string()
            }));
        }
        Ok(true) => {}
    }

    match db::series::create_episode(pool.get_ref(), &body).await {
        Ok(episode) => HttpResponse::Created().json(episode),
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({
            "error": e.to_string()
        })),
    }
}

pub async fn update_episode(
    pool: web::Data<PgPool>,
    path: web::Path<String>,
    body: web::Json<UpdateEpisodeInput>,
) -> HttpResponse {
    if let Err(resp) = check_series_enabled() {
        return resp;
    }
    let id = path.into_inner();
    if id.trim().is_empty() {
        return HttpResponse::BadRequest().json(serde_json::json!({
            "error": "Episode id is required"
        }));
    }

    match db::series::update_episode(pool.get_ref(), &id, &body).await {
        Ok(Some(episode)) => HttpResponse::Ok().json(episode),
        Ok(None) => HttpResponse::NotFound().json(serde_json::json!({
            "error": "Episode not found"
        })),
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({
            "error": e.to_string()
        })),
    }
}

pub async fn delete_episode(pool: web::Data<PgPool>, path: web::Path<String>) -> HttpResponse {
    if let Err(resp) = check_series_enabled() {
        return resp;
    }
    let id = path.into_inner();
    if id.trim().is_empty() {
        return HttpResponse::BadRequest().json(serde_json::json!({
            "error": "Episode id is required"
        }));
    }

    match db::series::delete_episode(pool.get_ref(), &id).await {
        Ok(true) => HttpResponse::Ok().json(serde_json::json!({ "deleted": true, "id": id })),
        Ok(false) => HttpResponse::NotFound().json(serde_json::json!({
            "error": "Episode not found"
        })),
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({
            "error": e.to_string()
        })),
    }
}
