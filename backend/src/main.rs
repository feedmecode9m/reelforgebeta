// src/main.rs

pub mod ai_detector;
pub mod api;
pub mod db;
pub mod asset_resolution;
pub mod asset_runtime;
pub mod experience;
pub mod media;
pub mod viewer_sim;
pub mod events;
pub mod handlers;
pub mod pipeline_diag;
pub mod ingestion;
pub mod media_durability;
pub mod media_api;
pub mod media_seed;
pub mod media_validator;
pub mod models;
pub mod no_compress;
pub mod reel_contract;
pub mod series_api;
pub mod security_api;
pub mod sync_api;
pub mod analytics_api;
pub mod notification_api;
pub mod pipeline_api;
pub mod team_api;
pub mod workflow_api;
pub mod utils;
pub mod video_stream;

use crate::events::ReelEvent;
use crate::no_compress::NoCompress;
use actix_cors::Cors;
use actix_web::{http::Method, middleware, web, App, HttpRequest, HttpResponse, HttpServer};
use events::EventBus;
use futures_util::StreamExt;
use sqlx::postgres::PgPoolOptions;
use std::env;
use std::time::Duration;
use tokio::sync::broadcast;

fn is_production_env() -> bool {
    let env = env::var("REELFORGE_ENV")
        .or_else(|_| env::var("RUST_ENV"))
        .unwrap_or_default();
    if matches!(env.as_str(), "production" | "prod") {
        return true;
    }
    // Railway/Render set platform env vars but not always REELFORGE_ENV.
    env::var("RAILWAY_ENVIRONMENT").is_ok() || env::var("RENDER").is_ok()
}

fn is_deployed_host() -> bool {
    is_production_env()
}

fn configure_cors() -> Cors {
    let mut cors = Cors::default()
        .allowed_methods(vec![
            Method::GET,
            Method::POST,
            Method::PUT,
            Method::DELETE,
            Method::OPTIONS,
            Method::HEAD,
            Method::PATCH,
        ])
        .allow_any_header()
        .expose_headers(vec![
            "Content-Range",
            "Accept-Ranges",
            "Content-Length",
            "Content-Type",
        ])
        .supports_credentials()
        .max_age(3600);

    let origins: Vec<String> = env::var("REELFORGE_CORS_ORIGINS")
        .map(|v| {
            v.split(',')
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect()
        })
        .unwrap_or_default();

    if origins.is_empty() && !is_production_env() {
        cors = cors
            .allowed_origin("http://localhost:5173")
            .allowed_origin("http://127.0.0.1:5173")
            .allowed_origin_fn(|origin, _req_head| {
                origin.as_bytes().starts_with(b"http://localhost:")
                    || origin.as_bytes().starts_with(b"http://127.0.0.1:")
            });
    } else {
        for origin in &origins {
            cors = cors.allowed_origin(origin.as_str());
        }
    }

    let allow_netlify = env::var("REELFORGE_CORS_ALLOW_NETLIFY")
        .map(|v| {
            let v = v.trim();
            v == "1" || v.eq_ignore_ascii_case("true") || v.eq_ignore_ascii_case("yes")
        })
        .unwrap_or(is_deployed_host());

    if allow_netlify {
        cors = cors.allowed_origin_fn(|origin, _req_head| {
            let allowed = origin
                .to_str()
                .map(|o| o.ends_with(".netlify.app") || o.ends_with(".netlify.live"))
                .unwrap_or(false);
            if !allowed {
                let origin_str = origin.to_str().unwrap_or("-");
                pipeline_diag::pipeline_diag(
                    "CORS",
                    "allowed_origin_fn",
                    "main.rs",
                    None,
                    None,
                    &format!("netlify_rejected:{}", origin_str),
                );
            }
            allowed
        });
    }

    pipeline_diag::pipeline_diag(
        "CORS",
        "configure_cors",
        "main.rs",
        None,
        None,
        "configured",
    );

    cors
}

async fn connect_database(db_url: &str) -> Result<sqlx::PgPool, sqlx::Error> {
    PgPoolOptions::new()
        .max_connections(5)
        .acquire_timeout(Duration::from_secs(5))
        .connect(db_url)
        .await
}

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    dotenvy::dotenv().ok();

    std::panic::set_hook(Box::new(|panic_info| {
        eprintln!("🔥 PANIC: {:?}", panic_info);
        if let Some(s) = panic_info.payload().downcast_ref::<&str>() {
            eprintln!("Panic payload: {}", s);
        }
    }));

    let mode = if is_production_env() {
        "production"
    } else {
        "development"
    };
    println!(
        "🔧 Mode: {} | Ingestion v2: {} | Studio hierarchy: {} | Series API: {} | Studio sync: {} | Platform config: {} | Monetization: {}",
        mode,
        if db::ingestion_v2_enabled() { "on" } else { "off" },
        if db::studio_hierarchy_enabled() { "on" } else { "off" },
        if db::series_api_enabled() { "on" } else { "off" },
        if db::studio_sync_enabled() { "on" } else { "off" },
        if db::platform_config_enabled() { "on" } else { "off" },
        if db::monetization_enabled() { "on" } else { "off" }
    );

    let db_url =
        env::var("DATABASE_URL").unwrap_or_else(|_| "postgres://localhost/reelforge".to_string());
    let (pool, db_available) = match connect_database(&db_url).await {
        Ok(p) => {
            println!("✅ Database connected");
            if let Err(e) = db::run_migrations(&p).await {
                eprintln!("❌ Migration failed: {}", e);
                std::process::exit(1);
            }
            println!("✅ Database migrations applied");
            (p, true)
        }
        Err(e) => {
            eprintln!("❌ Database required but unavailable: {}", e);
            eprintln!("   DATABASE_URL={}", db_url);
            eprintln!();
            eprintln!("   Start Postgres first (pick one):");
            eprintln!("   • Docker:  cd ~/projects/reelforge && docker compose up -d db");
            eprintln!("   • Script:  ~/projects/reelforge/backend/scripts/start-db.sh");
            eprintln!(
                "   • Native:  sudo apt install postgresql && sudo -u postgres createuser -s user"
            );
            eprintln!("              sudo -u postgres psql -c \"ALTER USER \\\"user\\\" WITH PASSWORD 'password';\"");
            eprintln!("              sudo -u postgres createdb -O user reelforge");
            eprintln!();
            eprintln!("   Verify:    pg_isready -h localhost -p 5432 -U user -d reelforge");
            std::process::exit(1);
        }
    };
    let worker_pool = pool.clone();
    let pool_data = web::Data::new(pool.clone());
    let db_available_data = web::Data::new(db_available);

    let event_bus = web::Data::new(EventBus::new(100));
    println!("📡 Real-time event system initialized");

    let public_path = std::path::PathBuf::from("./public");
    let thumbs_path = public_path.join("thumbs");
    let videos_path = public_path.join("videos");

    println!("📂 Serving videos from: {:?}", videos_path);
    println!("📂 Serving thumbs from: {:?}", thumbs_path);

    let _ = std::fs::create_dir_all(&thumbs_path);
    let _ = std::fs::create_dir_all(&videos_path);

    let split_brain_report = if db_available {
        match media_durability::split_brain_from_db(
            &pool,
            &public_path,
            &videos_path,
            &thumbs_path,
        )
        .await
        {
            Ok(report) => Some(report),
            Err(e) => {
                eprintln!("⚠️ Split-brain check skipped: {}", e);
                None
            }
        }
    } else {
        None
    };

    let startup_storage = media_durability::verify_startup_storage(
        &public_path,
        &videos_path,
        &thumbs_path,
        split_brain_report,
    );
    media_durability::log_startup_diagnostics(&startup_storage);

    crate::video_stream::log_media_directory("public/videos", &videos_path);
    crate::video_stream::log_media_directory("public/thumbs", &thumbs_path);
    crate::video_stream::verify_media_directories(&videos_path, &thumbs_path);
    crate::media_seed::log_asset_inventory(&videos_path, &thumbs_path);

    if db_available && db::ingestion_v2_enabled() && db::startup_reconcile_enabled() {
        let reconcile_bus = std::sync::Arc::new(event_bus.get_ref().clone());
        match ingestion::reconcile::reconcile_videos(
            &pool,
            &videos_path,
            &thumbs_path,
            ingestion::reconcile::ReconcileOptions::startup(),
            Some(reconcile_bus),
        )
        .await
        {
            Ok(report) => {
                println!(
                    "[reconcile] scanned={} imported={} skipped_cataloged={} skipped_invalid={} quarantined={} skipped_duplicate={} jobs_enqueued={} marked_ready={}",
                    report.scanned,
                    report.imported,
                    report.skipped_cataloged,
                    report.skipped_invalid,
                    report.quarantined,
                    report.skipped_duplicate_content,
                    report.jobs_enqueued,
                    report.marked_ready,
                );
                if !report.errors.is_empty() {
                    eprintln!("[reconcile] errors: {:?}", report.errors);
                }
            }
            Err(e) => eprintln!("[reconcile] failed: {}", e),
        }

        let (confirmed, rejected) =
            crate::db::reels::backfill_validated_ready_reels(&pool, &videos_path).await;
        if confirmed > 0 || rejected > 0 {
            println!(
                "[validation-backfill] confirmed={} rejected={}",
                confirmed, rejected
            );
        }
    }

    let videos_path_data = web::Data::new(crate::video_stream::VideosDir(videos_path.clone()));
    let thumbs_path_data = web::Data::new(crate::video_stream::ThumbsDir(thumbs_path.clone()));

    if db_available {
        let worker_videos = videos_path.clone();
        let worker_thumbs = thumbs_path.clone();
        let worker_bus = std::sync::Arc::new(event_bus.get_ref().clone());
        actix_web::rt::spawn(async move {
            ingestion::worker::run_worker(worker_pool, worker_videos, worker_thumbs, worker_bus)
                .await;
        });
        println!("✅ Ingestion worker spawned");
    }

    let port = env::var("PORT").unwrap_or_else(|_| "8080".to_string());
    let bind_address = format!("0.0.0.0:{}", port);
    println!("🚀 Binding to {}", bind_address);

    HttpServer::new(move || {
        App::new()
            .wrap(configure_cors())
            .wrap(NoCompress)
            .wrap(middleware::Logger::default())
            .wrap(middleware::DefaultHeaders::new().add(("Accept-Ranges", "bytes")))
            .app_data(web::PayloadConfig::new(104_857_600))
            .app_data(web::JsonConfig::default().limit(10_485_760))
            .app_data(pool_data.clone())
            .app_data(db_available_data.clone())
            .app_data(event_bus.clone())
            .app_data(videos_path_data.clone())
            .app_data(thumbs_path_data.clone())
            .route("/health", web::get().to(handlers::health_check))
            .route("/api/status", web::get().to(handlers::health_check))
            .route("/admin/auth", web::post().to(handlers::admin_auth))
            .route("/ws/control-center", web::get().to(control_center_ws))
            .service(
                web::scope("/api")
                    .route(
                        "/studio/local-videos",
                        web::get().to(handlers::list_local_videos),
                    )
                    .route("/studio/upload", web::post().to(handlers::upload_video))
                    .route("/upload", web::post().to(handlers::upload_video))
                    .route("/thumbnails", web::get().to(handlers::list_thumbnails))
                    .route("/videos", web::get().to(handlers::list_videos))
                    .route("/sync", web::get().to(handlers::sync_stats))
                    .route("/reels", web::get().to(handlers::get_reels))
                    .route("/reels", web::post().to(handlers::create_reel))
                    .route("/reels/{id}", web::get().to(handlers::get_reel_status))
                    .route("/reels/{id}", web::delete().to(handlers::delete_reel))
                    .route(
                        "/admin/migrate-media",
                        web::post().to(api::migrate::migrate_media),
                    )
                    .route(
                        "/reels/{id}/category",
                        web::patch().to(handlers::update_reel_category),
                    )
                    .route("/studio/status", web::get().to(api::studio::studio_status))
                    .route(
                        "/studio/projects",
                        web::get().to(api::studio::list_projects),
                    )
                    .route(
                        "/studio/projects",
                        web::post().to(api::studio::create_project),
                    )
                    .route(
                        "/studio/projects/{id}/tree",
                        web::get().to(api::studio::get_project_tree),
                    )
                    .route("/studio/series", web::get().to(api::studio::list_series))
                    .route("/studio/series", web::post().to(api::studio::create_series))
                    .route(
                        "/studio/seasons",
                        web::post().to(api::studio::create_season),
                    )
                    .route(
                        "/studio/seasons/{id}/episodes",
                        web::get().to(api::studio::list_episodes),
                    )
                    .route(
                        "/studio/episodes",
                        web::post().to(api::studio::create_episode),
                    )
                    .route(
                        "/studio/episodes/{id}/attach-reel",
                        web::post().to(api::studio::attach_reel),
                    )
                    .route(
                        "/studio/backfill",
                        web::post().to(api::studio::backfill_hierarchy),
                    )
                    .route(
                        "/series/status",
                        web::get().to(api::series_api::series_status),
                    )
                    .route("/series", web::get().to(api::series_api::list_series))
                    .route("/series", web::post().to(api::series_api::create_series))
                    .route("/series/{id}", web::get().to(api::series_api::get_series))
                    .route("/series/{id}", web::put().to(api::series_api::update_series))
                    .route(
                        "/series/{id}/seasons",
                        web::get().to(api::series_api::list_series_seasons),
                    )
                    .route(
                        "/series/{id}/seasons",
                        web::post().to(api::series_api::create_series_season),
                    )
                    .route(
                        "/series/{id}/episodes",
                        web::get().to(api::series_api::list_series_episodes),
                    )
                    .route("/episodes", web::post().to(api::series_api::create_episode))
                    .route("/episodes/{id}", web::put().to(api::series_api::update_episode))
                    .route("/episodes/{id}", web::delete().to(api::series_api::delete_episode))
                    .route("/sync/status", web::get().to(api::sync_api::sync_status))
                    .route("/sync/state", web::get().to(api::sync_api::get_sync_state))
                    .route("/sync/push", web::post().to(api::sync_api::push_sync))
                    .route("/sync/state", web::put().to(api::sync_api::push_sync_state))
                    .route(
                        "/workflow/status",
                        web::get().to(api::workflow_api::workflow_status),
                    )
                    .route("/workflow/tasks", web::get().to(api::workflow_api::list_tasks))
                    .route("/workflow/tasks", web::post().to(api::workflow_api::create_task))
                    .route("/workflow/tasks/{id}", web::put().to(api::workflow_api::update_task))
                    .route("/workflow/tasks/{id}", web::delete().to(api::workflow_api::delete_task))
                    .route(
                        "/analytics/status",
                        web::get().to(api::analytics_api::analytics_status),
                    )
                    .route("/analytics", web::post().to(api::analytics_api::ingest_analytics))
                    .route(
                        "/analytics/dashboard",
                        web::get().to(api::analytics_api::analytics_dashboard),
                    )
                    .route(
                        "/analytics/series/{id}",
                        web::get().to(api::analytics_api::analytics_series),
                    )
                    .route("/teams/status", web::get().to(api::team_api::team_status))
                    .route("/users", web::get().to(api::team_api::list_users))
                    .route("/users", web::post().to(api::team_api::create_user))
                    .route("/teams", web::get().to(api::team_api::list_teams))
                    .route("/teams", web::post().to(api::team_api::create_team))
                    .route("/teams/{id}", web::get().to(api::team_api::get_team))
                    .route("/teams/{id}/members", web::get().to(api::team_api::list_team_members))
                    .route("/teams/{id}/members", web::post().to(api::team_api::add_team_member))
                    .route(
                        "/teams/{id}/members/{user_id}",
                        web::put().to(api::team_api::update_team_member),
                    )
                    .route(
                        "/teams/{id}/members/{user_id}",
                        web::delete().to(api::team_api::remove_team_member),
                    )
                    .route(
                        "/teams/{id}/activity",
                        web::get().to(api::team_api::list_team_activity),
                    )
                    .route(
                        "/teams/{id}/assign-task",
                        web::post().to(api::team_api::assign_team_task),
                    )
                    .route(
                        "/teams/{id}/assigned-tasks",
                        web::get().to(api::team_api::list_assigned_tasks),
                    )
                    .route(
                        "/notifications/status",
                        web::get().to(api::notification_api::notification_status),
                    )
                    .route(
                        "/notifications/unread-count",
                        web::get().to(api::notification_api::unread_count),
                    )
                    .route(
                        "/notifications",
                        web::get().to(api::notification_api::list_notifications),
                    )
                    .route(
                        "/notifications",
                        web::post().to(api::notification_api::create_notification),
                    )
                    .route(
                        "/notifications/read-all",
                        web::put().to(api::notification_api::mark_all_notifications_read),
                    )
                    .route(
                        "/notifications/{id}/read",
                        web::put().to(api::notification_api::mark_notification_read),
                    )
                    .route(
                        "/pipeline/status",
                        web::get().to(api::pipeline_api::pipeline_status),
                    )
                    .route("/pipeline", web::get().to(api::pipeline_api::list_pipeline))
                    .route(
                        "/pipeline/{episode_id}",
                        web::put().to(api::pipeline_api::update_pipeline),
                    )
                    .route(
                        "/platform/status",
                        web::get().to(api::platform_config::platform_status),
                    )
                    .route(
                        "/platform/config",
                        web::get().to(api::platform_config::get_config),
                    )
                    .route(
                        "/platform/site",
                        web::get().to(api::platform_config::get_site),
                    )
                    .route(
                        "/platform/site",
                        web::put().to(api::platform_config::update_site),
                    )
                    .route(
                        "/platform/hero",
                        web::get().to(api::platform_config::get_hero),
                    )
                    .route(
                        "/platform/hero",
                        web::put().to(api::platform_config::update_hero),
                    )
                    .route(
                        "/platform/features",
                        web::get().to(api::platform_config::get_features),
                    )
                    .route(
                        "/platform/features",
                        web::put().to(api::platform_config::update_features),
                    )
                    .route(
                        "/platform/campaigns",
                        web::get().to(api::platform_config::list_campaigns),
                    )
                    .route(
                        "/platform/campaigns",
                        web::post().to(api::platform_config::create_campaign),
                    )
                    .route(
                        "/platform/campaigns/{id}",
                        web::get().to(api::platform_config::get_campaign),
                    )
                    .route(
                        "/platform/campaigns/{id}",
                        web::put().to(api::platform_config::update_campaign),
                    )
                    .route(
                        "/platform/campaigns/{id}",
                        web::delete().to(api::platform_config::delete_campaign),
                    )
                    .route(
                        "/monetization/status",
                        web::get().to(api::monetization::monetization_status),
                    )
                    .route(
                        "/monetization/config",
                        web::get().to(api::monetization::get_config),
                    )
                    .route(
                        "/monetization/projects/{id}",
                        web::get().to(api::monetization::get_project),
                    )
                    .route(
                        "/monetization/projects/{id}",
                        web::put().to(api::monetization::update_project),
                    )
                    .route(
                        "/monetization/series/{id}",
                        web::get().to(api::monetization::get_series),
                    )
                    .route(
                        "/monetization/series/{id}",
                        web::put().to(api::monetization::update_series),
                    )
                    .route(
                        "/monetization/seasons/{id}",
                        web::get().to(api::monetization::get_season),
                    )
                    .route(
                        "/monetization/seasons/{id}",
                        web::put().to(api::monetization::update_season),
                    )
                    .route(
                        "/monetization/episodes/{id}",
                        web::get().to(api::monetization::get_episode),
                    )
                    .route(
                        "/monetization/episodes/{id}",
                        web::put().to(api::monetization::update_episode),
                    )
                    .route(
                        "/revenue/dashboard",
                        web::get().to(api::revenue_api::get_revenue_dashboard),
                    )
                    .route(
                        "/revenue/forecast",
                        web::get().to(api::revenue_api::get_revenue_forecast),
                    )
                    .route(
                        "/revenue/profile",
                        web::post().to(api::revenue_api::post_revenue_profile),
                    )
                    .route(
                        "/revenue/creator/{id}",
                        web::get().to(api::revenue_api::get_creator_revenue),
                    )
                    .route(
                        "/experience/resolve",
                        web::get().to(api::experience::get_experience_resolve),
                    )
                    .route("/watch/status", web::get().to(api::watch::watch_status))
                    .route("/watch/event", web::post().to(api::watch::post_watch_event))
                    .route(
                        "/watch/progress/{episode}",
                        web::get().to(api::watch::get_watch_progress),
                    )
                    .route(
                        "/watch/continue",
                        web::get().to(api::watch::get_continue_watching),
                    )
                    .route(
                        "/security/events/status",
                        web::get().to(api::security_api::security_events_status),
                    )
                    .route(
                        "/security/events",
                        web::get().to(api::security_api::get_security_events),
                    )
                    .route(
                        "/security/events",
                        web::post().to(api::security_api::post_security_event),
                    )
                    .route(
                        "/stats/categories",
                        web::get().to(handlers::get_category_stats),
                    )
                    .route(
                        "/storage/file/{filename:.*}",
                        web::delete().to(handlers::delete_storage_file),
                    )
                    .route(
                        "/dev/client-log",
                        web::post().to(handlers::ingest_client_log),
                    )
                    .route("/health", web::get().to(handlers::health_check))
                    .service(
                        web::scope("/media")
                            .route("/validate", web::post().to(media_api::media_validate))
                            .route("/storage", web::get().to(media_api::media_storage))
                            .route(
                                "/storage/diagnostics",
                                web::get().to(media_api::media_storage_diagnostics),
                            )
                            .route(
                                "/storage/{filename:.*}",
                                web::delete().to(media_api::media_storage_delete),
                            )
                            .route(
                                "/cleanup/orphans",
                                web::get().to(media_api::media_cleanup_orphans_get),
                            )
                            .route(
                                "/cleanup/orphans",
                                web::post().to(media_api::media_cleanup_orphans_post),
                            ),
                    ),
            )
            .route(
                "/videos/{filename:.*}",
                web::get().to(video_stream::serve_video),
            )
            .route(
                "/videos/{filename:.*}",
                web::head().to(video_stream::serve_video),
            )
            .route(
                "/thumbs/{filename:.*}",
                web::get().to(video_stream::serve_thumb),
            )
            .route(
                "/thumbs/{filename:.*}",
                web::head().to(video_stream::serve_thumb),
            )
            .route("/ingest/{session:.*}", web::post().to(debug_ingest_noop))
            .route(
                "/ingest/{session:.*}",
                web::route()
                    .method(Method::OPTIONS)
                    .to(debug_ingest_options),
            )
            .route(
                "/",
                web::get().to(|| async {
                    HttpResponse::Ok().body("ReelForge backend is running with real-time sync")
                }),
            )
    })
    .bind(bind_address)?
    .run()
    .await
}

/// Dev telemetry sink (replaces separate :7463 ingest — avoids browser CORS failures).
async fn debug_ingest_noop(_path: web::Path<String>, _body: web::Bytes) -> HttpResponse {
    HttpResponse::NoContent().finish()
}

async fn debug_ingest_options() -> HttpResponse {
    HttpResponse::Ok().finish()
}

async fn control_center_ws(
    req: HttpRequest,
    body: web::Payload,
    event_bus: web::Data<EventBus>,
) -> Result<HttpResponse, actix_web::Error> {
    let (response, mut session, mut msg_stream) = actix_ws::handle(&req, body)?;
    let mut event_rx: broadcast::Receiver<ReelEvent> = event_bus.subscribe();

    actix_web::rt::spawn(async move {
        loop {
            tokio::select! {
                Ok(event) = event_rx.recv() => {
                    let msg = match event {
                        ReelEvent::Deleted { id, title, category, deleted_at } => {
                            serde_json::json!({ "type": "DELETED", "id": id, "title": title, "category": category, "deleted_at": deleted_at }).to_string()
                        }
                        ReelEvent::Created(reel) => {
                            if reel_contract::ws_full_payload_enabled() {
                                reel_contract::reel_created_ws_json(&reel)
                            } else {
                                reel_contract::reel_created_ws_json_legacy(&reel)
                            }
                        }
                    };
                    if session.text(msg).await.is_err() { break; }
                }
                msg = msg_stream.next() => {
                    match msg {
                        Some(Ok(actix_ws::Message::Ping(bytes))) => {
                            if session.pong(&bytes).await.is_err() { break; }
                        }
                        Some(Ok(actix_ws::Message::Close(_))) => break,
                        None => break,
                        _ => {}
                    }
                }
            }
        }
    });
    Ok(response)
}
