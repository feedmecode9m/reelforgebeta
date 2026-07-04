use actix_web::{web, HttpResponse};
use sqlx::PgPool;
use uuid::Uuid;

use crate::db;
use crate::db::platform_config::{
    CreateCampaign, UpdateCampaign, UpdateFeatureFlags, UpdateHeroConfig, UpdateSiteConfig,
};

fn platform_disabled() -> HttpResponse {
    HttpResponse::NotFound().json(serde_json::json!({
        "error": "Platform configuration disabled",
        "hint": "Set REELFORGE_PLATFORM_CONFIG=true to enable"
    }))
}

fn check_platform_enabled() -> Result<(), HttpResponse> {
    if db::platform_config_enabled() {
        Ok(())
    } else {
        Err(platform_disabled())
    }
}

pub async fn platform_status(pool: web::Data<PgPool>) -> HttpResponse {
    if let Err(resp) = check_platform_enabled() {
        return resp;
    }
    match db::platform_config::get_full_config(pool.get_ref()).await {
        Ok(config) => HttpResponse::Ok().json(serde_json::json!({
            "enabled": true,
            "updatedAt": config.site.updated_at,
            "campaignCount": config.campaigns.len()
        })),
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({
            "error": e.to_string()
        })),
    }
}

pub async fn get_config(pool: web::Data<PgPool>) -> HttpResponse {
    if let Err(resp) = check_platform_enabled() {
        return resp;
    }
    match db::platform_config::get_full_config(pool.get_ref()).await {
        Ok(config) => HttpResponse::Ok().json(config),
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({
            "error": e.to_string()
        })),
    }
}

pub async fn get_site(pool: web::Data<PgPool>) -> HttpResponse {
    if let Err(resp) = check_platform_enabled() {
        return resp;
    }
    match db::platform_config::get_site_config(pool.get_ref()).await {
        Ok(row) => HttpResponse::Ok().json(row),
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({
            "error": e.to_string()
        })),
    }
}

pub async fn update_site(
    pool: web::Data<PgPool>,
    body: web::Json<UpdateSiteConfig>,
) -> HttpResponse {
    if let Err(resp) = check_platform_enabled() {
        return resp;
    }
    match db::platform_config::update_site_config(pool.get_ref(), &*body).await {
        Ok(row) => HttpResponse::Ok().json(row),
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({
            "error": e.to_string()
        })),
    }
}

pub async fn get_hero(pool: web::Data<PgPool>) -> HttpResponse {
    if let Err(resp) = check_platform_enabled() {
        return resp;
    }
    match db::platform_config::get_hero_config(pool.get_ref()).await {
        Ok(row) => HttpResponse::Ok().json(row),
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({
            "error": e.to_string()
        })),
    }
}

pub async fn update_hero(
    pool: web::Data<PgPool>,
    body: web::Json<UpdateHeroConfig>,
) -> HttpResponse {
    if let Err(resp) = check_platform_enabled() {
        return resp;
    }
    match db::platform_config::update_hero_config(pool.get_ref(), &*body).await {
        Ok(Ok(row)) => HttpResponse::Ok().json(row),
        Ok(Err(msg)) => HttpResponse::BadRequest().json(serde_json::json!({ "error": msg })),
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({
            "error": e.to_string()
        })),
    }
}

pub async fn get_features(pool: web::Data<PgPool>) -> HttpResponse {
    if let Err(resp) = check_platform_enabled() {
        return resp;
    }
    match db::platform_config::get_feature_flags(pool.get_ref()).await {
        Ok(row) => HttpResponse::Ok().json(row),
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({
            "error": e.to_string()
        })),
    }
}

pub async fn update_features(
    pool: web::Data<PgPool>,
    body: web::Json<UpdateFeatureFlags>,
) -> HttpResponse {
    if let Err(resp) = check_platform_enabled() {
        return resp;
    }
    match db::platform_config::update_feature_flags(pool.get_ref(), &*body).await {
        Ok(row) => HttpResponse::Ok().json(row),
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({
            "error": e.to_string()
        })),
    }
}

pub async fn list_campaigns(pool: web::Data<PgPool>) -> HttpResponse {
    if let Err(resp) = check_platform_enabled() {
        return resp;
    }
    match db::platform_config::list_campaigns(pool.get_ref()).await {
        Ok(rows) => HttpResponse::Ok().json(rows),
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({
            "error": e.to_string()
        })),
    }
}

pub async fn get_campaign(pool: web::Data<PgPool>, path: web::Path<String>) -> HttpResponse {
    if let Err(resp) = check_platform_enabled() {
        return resp;
    }
    let id = match Uuid::parse_str(&path.into_inner()) {
        Ok(u) => u,
        Err(_) => {
            return HttpResponse::BadRequest().json(serde_json::json!({
                "error": "Invalid campaign id"
            }));
        }
    };
    match db::platform_config::get_campaign(pool.get_ref(), id).await {
        Ok(Some(row)) => HttpResponse::Ok().json(row),
        Ok(None) => HttpResponse::NotFound().json(serde_json::json!({
            "error": "Campaign not found"
        })),
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({
            "error": e.to_string()
        })),
    }
}

pub async fn create_campaign(
    pool: web::Data<PgPool>,
    body: web::Json<CreateCampaign>,
) -> HttpResponse {
    if let Err(resp) = check_platform_enabled() {
        return resp;
    }
    match db::platform_config::create_campaign(pool.get_ref(), &*body).await {
        Ok(Ok(row)) => HttpResponse::Created().json(row),
        Ok(Err(msg)) => HttpResponse::BadRequest().json(serde_json::json!({ "error": msg })),
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({
            "error": e.to_string()
        })),
    }
}

pub async fn update_campaign(
    pool: web::Data<PgPool>,
    path: web::Path<String>,
    body: web::Json<UpdateCampaign>,
) -> HttpResponse {
    if let Err(resp) = check_platform_enabled() {
        return resp;
    }
    let id = match Uuid::parse_str(&path.into_inner()) {
        Ok(u) => u,
        Err(_) => {
            return HttpResponse::BadRequest().json(serde_json::json!({
                "error": "Invalid campaign id"
            }));
        }
    };
    match db::platform_config::update_campaign(pool.get_ref(), id, &*body).await {
        Ok(Ok(row)) => HttpResponse::Ok().json(row),
        Ok(Err(msg)) => {
            if msg == "Campaign not found" {
                HttpResponse::NotFound().json(serde_json::json!({ "error": msg }))
            } else {
                HttpResponse::BadRequest().json(serde_json::json!({ "error": msg }))
            }
        }
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({
            "error": e.to_string()
        })),
    }
}

pub async fn delete_campaign(pool: web::Data<PgPool>, path: web::Path<String>) -> HttpResponse {
    if let Err(resp) = check_platform_enabled() {
        return resp;
    }
    let id = match Uuid::parse_str(&path.into_inner()) {
        Ok(u) => u,
        Err(_) => {
            return HttpResponse::BadRequest().json(serde_json::json!({
                "error": "Invalid campaign id"
            }));
        }
    };
    match db::platform_config::delete_campaign(pool.get_ref(), id).await {
        Ok(true) => HttpResponse::Ok().json(serde_json::json!({ "deleted": true })),
        Ok(false) => HttpResponse::NotFound().json(serde_json::json!({
            "error": "Campaign not found"
        })),
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({
            "error": e.to_string()
        })),
    }
}
